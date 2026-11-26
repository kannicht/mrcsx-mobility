#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO"

IMAGE="${1:-mrcsx-mobility:ci}"

FIXTURE_DIR="$(mktemp -d)"
SUFFIX="$(openssl rand -hex 6)"

NETWORK="mobility-test-$SUFFIX"
JWKS_CONTAINER="mobility-jwks-$SUFFIX"
MOBILITY_CONTAINER="mobility-app-$SUFFIX"

cleanup() {
    local status=$?

    trap - EXIT
    set +e

    if (( status != 0 ))
    then
        echo "=== Mobility Container Logs ==="
        docker logs "$MOBILITY_CONTAINER" 2>&1 || true

        echo "=== JWKS Container Logs ==="
        docker logs "$JWKS_CONTAINER" 2>&1 || true
    fi

    echo "==> Entferne temporäre Testressourcen"

    docker rm -f "$MOBILITY_CONTAINER" >/dev/null 2>&1 || true
    docker rm -f "$JWKS_CONTAINER" >/dev/null 2>&1 || true
    docker network rm "$NETWORK" >/dev/null 2>&1 || true

    rm -rf -- "$FIXTURE_DIR"

    exit "$status"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "==> Prüfe Container-Image"

docker image inspect "$IMAGE" >/dev/null

echo "==> Generiere OAuth-Testdaten"

node tests/docker/generate-fixture.ts "$FIXTURE_DIR"

mkdir -p "$FIXTURE_DIR/jwks" "$FIXTURE_DIR/trust"

mv "$FIXTURE_DIR/jwks.json" "$FIXTURE_DIR/jwks/"

cp tests/docker/jwks-server.mjs "$FIXTURE_DIR/jwks/"

echo "==> Erzeuge temporäre TLS-Zertifikate"

openssl req -x509 \
    -newkey rsa:2048 \
    -nodes \
    -days 1 \
    -subj "/CN=Mobility Test CA" \
    -keyout "$FIXTURE_DIR/ca.key" \
    -out "$FIXTURE_DIR/trust/ca.crt" \
    >/dev/null 2>&1

openssl req \
    -new \
    -newkey rsa:2048 \
    -nodes \
    -subj "/CN=oauth-fixture" \
    -keyout "$FIXTURE_DIR/jwks/server.key" \
    -out "$FIXTURE_DIR/server.csr" \
    >/dev/null 2>&1

cat > "$FIXTURE_DIR/server.ext" <<'EXT'
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:oauth-fixture
EXT

openssl x509 -req \
    -in "$FIXTURE_DIR/server.csr" \
    -CA "$FIXTURE_DIR/trust/ca.crt" \
    -CAkey "$FIXTURE_DIR/ca.key" \
    -CAcreateserial \
    -days 1 \
    -sha256 \
    -extfile "$FIXTURE_DIR/server.ext" \
    -out "$FIXTURE_DIR/jwks/server.crt" \
    >/dev/null 2>&1

chmod 0755 "$FIXTURE_DIR/jwks" "$FIXTURE_DIR/trust"
chmod 0644 "$FIXTURE_DIR/jwks/"*
chmod 0644 "$FIXTURE_DIR/trust/ca.crt"

echo "==> Erstelle Docker-Testnetzwerk"

docker network create "$NETWORK" >/dev/null

echo "==> Starte HTTPS-JWKS-Server"

docker run -d \
    --name "$JWKS_CONTAINER" \
    --network "$NETWORK" \
    --network-alias oauth-fixture \
    --init \
    --read-only \
    --cap-drop=ALL \
    --security-opt=no-new-privileges:true \
    --memory=128m \
    --cpus=0.5 \
    --pids-limit=64 \
    --no-healthcheck \
    --mount "type=bind,source=$FIXTURE_DIR/jwks,target=/fixture,readonly" \
    "$IMAGE" \
    node /fixture/jwks-server.mjs

echo "==> Starte Mobility-Testcontainer"

docker run -d \
    --name "$MOBILITY_CONTAINER" \
    --network "$NETWORK" \
    --init \
    --read-only \
    --cap-drop=ALL \
    --security-opt=no-new-privileges:true \
    --memory=256m \
    --cpus=1 \
    --pids-limit=128 \
    --mount "type=bind,source=$FIXTURE_DIR/trust,target=/trust,readonly" \
    -e NODE_EXTRA_CA_CERTS=/trust/ca.crt \
    -e MOBILITY_PUBLIC_HOST=mobility.example.test \
    -e MOBILITY_OAUTH_ISSUER=https://oauth-fixture:3443 \
    -e MOBILITY_OAUTH_RESOURCE=https://mobility.example.test/mcp \
    -e MOBILITY_OAUTH_JWKS_URI=https://oauth-fixture:3443/.well-known/jwks.json \
    -e MOBILITY_OAUTH_SCOPE=mobility:read \
    -e MOBILITY_OAUTH_CLIENT_ID=11111111-1111-4111-8111-111111111111 \
    -e MOBILITY_OAUTH_ALLOWED_SUBJECT=22222222-2222-4222-8222-222222222222 \
    -p 127.0.0.1::3100 \
    "$IMAGE"

ADDRESS="$(docker port "$MOBILITY_CONTAINER" 3100/tcp)"
BASE_URL="http://$ADDRESS"

echo "==> Warte auf Mobility-Healthcheck"

READY=0

for ((i=1; i<=30; i++))
do
    if curl -fsS --max-time 2 "$BASE_URL/health" >/dev/null 2>&1
    then
        READY=1
        break
    fi

    sleep 1
done

if (( READY != 1 ))
then
    echo "Mobility Healthcheck fehlgeschlagen" >&2
    exit 1
fi

echo "==> Prüfe HTTPS-Verbindung zum JWKS-Server"

READY=0

for ((i=1; i<=15; i++))
do
    if docker exec "$MOBILITY_CONTAINER" node -e \
        'fetch(process.env.MOBILITY_OAUTH_JWKS_URI, {
            signal: AbortSignal.timeout(2000)
        }).then(r => process.exit(r.ok ? 0 : 1))
          .catch(() => process.exit(1))'
    then
        READY=1
        break
    fi

    sleep 1
done

if (( READY != 1 ))
then
    echo "HTTPS-JWKS-Verbindung fehlgeschlagen" >&2
    exit 1
fi

echo "==> Führe Docker-Smoke-Tests aus"

node tests/docker/smoke.ts "$FIXTURE_DIR" "$BASE_URL"

echo "==> Container-Ressourcenverbrauch"

docker stats --no-stream \
    "$MOBILITY_CONTAINER" \
    "$JWKS_CONTAINER"

echo
echo "OK - Docker OAuth smoke tests passed"
