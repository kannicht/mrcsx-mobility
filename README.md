# mrcsx-mobility

Private, self-hosted MCP server for public transport
information and journey planning.

## Status

Version 0.2.0

- MCP Streamable HTTP transport
- Mandatory OAuth 2.0 authentication
- Pocket ID integration
- Mock mobility data
- No external transport APIs yet

## Architecture

- TypeScript
- Node.js 24
- Model Context Protocol SDK v2
- Zod
- jose
- Docker
- GitHub Actions
- GitHub Container Registry

## Security

All MCP requests require a valid OAuth access token.

The server validates:

- RS256 signature using remote JWKS
- Access token type (at+jwt)
- Issuer
- Resource audience
- Token expiration and issuance time
- Authorized OAuth client ID
- Authorized user subject
- Required mobility:read scope

Missing or invalid OAuth configuration prevents startup.

There is no unauthenticated MCP mode.

Host and Origin validation provide additional protection.

The server never requires the OAuth client secret
and does not intentionally log access tokens.

## Configuration

| Environment variable | Required | Default |
| --- | --- | --- |
| MOBILITY_HOST | No | 127.0.0.1 |
| MOBILITY_PORT | No | 3100 |
| MOBILITY_PUBLIC_HOST | Behind reverse proxy | - |
| MOBILITY_OAUTH_ISSUER | Yes | - |
| MOBILITY_OAUTH_RESOURCE | Yes | - |
| MOBILITY_OAUTH_JWKS_URI | Yes | - |
| MOBILITY_OAUTH_SCOPE | Yes | - |
| MOBILITY_OAUTH_CLIENT_ID | Yes | - |
| MOBILITY_OAUTH_ALLOWED_SUBJECT | Yes | - |

Example configuration:

    MOBILITY_PUBLIC_HOST=mobility.example.com
    MOBILITY_OAUTH_ISSUER=https://id.example.com
    MOBILITY_OAUTH_RESOURCE=https://mobility.example.com/mcp
    MOBILITY_OAUTH_JWKS_URI=https://id.example.com/.well-known/jwks.json
    MOBILITY_OAUTH_SCOPE=mobility:read
    MOBILITY_OAUTH_CLIENT_ID=11111111-1111-4111-8111-111111111111
    MOBILITY_OAUTH_ALLOWED_SUBJECT=22222222-2222-4222-8222-222222222222

## HTTP endpoints

| Endpoint | Authentication |
| --- | --- |
| GET /health | Public |
| GET /.well-known/oauth-protected-resource/mcp | Public |
| /mcp | OAuth required |

The public endpoints expose only service health
and OAuth discovery metadata.

## MCP tools

### mobility_ping

Read-only connectivity check.

Accepts an optional nonce and returns:

- Service name
- Application version
- Status
- Operating mode
- UTC timestamp
- Original nonce

## Development

    npm ci --ignore-scripts
    npm run check
    npm audit --audit-level=high

Start the application with a valid OAuth configuration:

    npm run dev

## Docker testing

    docker build -t mrcsx-mobility:ci .
    bash tests/docker/run.sh mrcsx-mobility:ci

The Docker smoke tests create an isolated test environment
with temporary RSA keys, TLS certificates and access tokens.

No production credentials or external identity providers
are required for automated tests.

TLS verification remains enabled.

## Release process

GitHub Actions runs:

1. Dependency installation
2. Security audit
3. Type checking
4. Automated integration and security tests
5. Docker image build
6. Fail-closed startup verification
7. Authenticated Docker smoke tests

Version tags trigger publication of the exact tested
Docker image to the private GitHub Container Registry.

## Deployment

Production deployment is managed by mrcsx-infra.

Container images are pinned by digest.

OAuth configuration is supplied through environment
variables in the production Compose configuration.

The MCP endpoint must not be exposed without verified
authentication enforcement.

## Roadmap

- [x] MCP connectivity proof of concept
- [x] Private container registry
- [x] Automated deployment
- [x] Mandatory OAuth authentication
- [ ] Production Pocket ID and ChatGPT integration verified
- [ ] Transitous integration
- [ ] Stop and station search
- [ ] Journey planning
- [ ] Real-time departures
- [ ] Calendar integration

## License

Private project. Not licensed for redistribution.
