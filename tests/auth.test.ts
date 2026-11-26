import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
} from "jose";

import type { JWTPayload } from "jose";

import { loadAuthConfig } from "../src/auth/config.ts";
import { createTokenVerifier } from "../src/auth/verifier.ts";

const env = {
  MOBILITY_OAUTH_ISSUER: "https://id.example.test",
  MOBILITY_OAUTH_RESOURCE: "https://mobility.example.test/mcp",
  MOBILITY_OAUTH_JWKS_URI: "https://id.example.test/.well-known/jwks.json",
  MOBILITY_OAUTH_SCOPE: "mobility:read",
  MOBILITY_OAUTH_CLIENT_ID: "11111111-1111-4111-8111-111111111111",
  MOBILITY_OAUTH_ALLOWED_SUBJECT: "22222222-2222-4222-8222-222222222222",
};

const config = loadAuthConfig(env);

test("OAuth configuration", async (t) => {
  await t.test("Valid configuration accepted", () => {
    assert.equal(config.scope, "mobility:read");
    assert.ok(Object.isFrozen(config));
  });

  for (const key of Object.keys(env)) {
    await t.test(`Missing ${key} rejected`, () => {
      assert.throws(() =>
        loadAuthConfig({
          ...env,
          [key]: undefined,
        }),
      );
    });
  }

  await t.test("Insecure issuer rejected", () => {
    assert.throws(() =>
      loadAuthConfig({
        ...env,
        MOBILITY_OAUTH_ISSUER: "http://id.example.test",
      }),
    );
  });

  await t.test("Foreign JWKS origin rejected", () => {
    assert.throws(() =>
      loadAuthConfig({
        ...env,
        MOBILITY_OAUTH_JWKS_URI: "https://foreign.example.test/jwks",
      }),
    );
  });

  await t.test("Incorrect resource path rejected", () => {
    assert.throws(() =>
      loadAuthConfig({
        ...env,
        MOBILITY_OAUTH_RESOURCE: "https://mobility.example.test/other",
      }),
    );
  });

  await t.test("Incorrect scope rejected", () => {
    assert.throws(() =>
      loadAuthConfig({
        ...env,
        MOBILITY_OAUTH_SCOPE: "mobility:write",
      }),
    );
  });

  await t.test("Invalid subject rejected", () => {
    assert.throws(() =>
      loadAuthConfig({
        ...env,
        MOBILITY_OAUTH_ALLOWED_SUBJECT: "username",
      }),
    );
  });
});

test("Access token verification", async (t) => {
  const { publicKey, privateKey } =
    await generateKeyPair("RS256");

  const foreignKeys = await generateKeyPair("RS256");

  const jwk = {
    ...await exportJWK(publicKey),
    kid: "test-key",
    alg: "RS256",
    use: "sig",
  };

  const verify = createTokenVerifier(
    config,
    createLocalJWKSet({ keys: [jwk] }),
  );

  async function sign(
    overrides: JWTPayload = {},
    options: {
      typ?: string;
      foreignKey?: boolean;
    } = {},
  ): Promise<string> {
    const now = Math.floor(Date.now() / 1000);

    return new SignJWT({
      iss: config.issuer,
      aud: config.resource,
      sub: config.allowedSubject,
      client_id: config.clientId,
      scope: config.scope,
      iat: now,
      exp: now + 300,
      ...overrides,
    })
      .setProtectedHeader({
        alg: "RS256",
        typ: options.typ ?? "at+jwt",
        kid: "test-key",
      })
      .sign(
        options.foreignKey
          ? foreignKeys.privateKey
          : privateKey,
      );
  }

  async function rejectToken(
    token: string,
    status: 401 | 403,
    error: string,
  ): Promise<void> {
    assert.deepEqual(
      await verify(`Bearer ${token}`),
      { ok: false, status, error },
    );
  }

  await t.test("Missing authorization rejected", async () => {
    assert.deepEqual(await verify(undefined), {
      ok: false,
      status: 401,
      error: "invalid_token",
    });
  });

  await t.test("Malformed authorization rejected", async () => {
    for (const value of [
      "",
      "Bearer",
      "Basic abc",
      "Bearer invalid",
      "Bearer a.b.c",
      "Bearer a.b.c, Bearer d.e.f",
    ]) {
      assert.deepEqual(await verify(value), {
        ok: false,
        status: 401,
        error: "invalid_token",
      });
    }
  });

  await t.test("Foreign signature rejected", async () => {
    await rejectToken(
      await sign({}, { foreignKey: true }),
      401,
      "invalid_token",
    );
  });

  await t.test("Incorrect algorithm rejected", async () => {
    const now = Math.floor(Date.now() / 1000);

    const token = await new SignJWT({
      iss: config.issuer,
      aud: config.resource,
      sub: config.allowedSubject,
      client_id: config.clientId,
      scope: config.scope,
      iat: now,
      exp: now + 300,
    })
      .setProtectedHeader({
        alg: "HS256",
        typ: "at+jwt",
        kid: "test-key",
      })
      .sign(new Uint8Array(32).fill(1));

    await rejectToken(token, 401, "invalid_token");
  });

  await t.test("Incorrect issuer rejected", async () => {
    await rejectToken(
      await sign({ iss: "https://foreign.example.test" }),
      401,
      "invalid_token",
    );
  });

  await t.test("Incorrect audience rejected", async () => {
    await rejectToken(
      await sign({ aud: "https://other.example.test/mcp" }),
      401,
      "invalid_token",
    );
  });

  await t.test("Expired token rejected", async () => {
    const now = Math.floor(Date.now() / 1000);

    await rejectToken(
      await sign({ iat: now - 600, exp: now - 300 }),
      401,
      "invalid_token",
    );
  });

  await t.test("Future-issued token rejected", async () => {
    await rejectToken(
      await sign({
        iat: Math.floor(Date.now() / 1000) + 60,
      }),
      401,
      "invalid_token",
    );
  });

  await t.test("Token not yet valid rejected", async () => {
    await rejectToken(
      await sign({
        nbf: Math.floor(Date.now() / 1000) + 60,
      }),
      401,
      "invalid_token",
    );
  });

  await t.test("Missing required claims rejected", async () => {
    for (const claim of [
      "iss", "aud", "exp", "iat", "sub", "client_id",
    ]) {
      await rejectToken(
        await sign({ [claim]: undefined }),
        401,
        "invalid_token",
      );
    }
  });

  await t.test("ID token rejected", async () => {
    await rejectToken(
      await sign({}, { typ: "JWT" }),
      401,
      "invalid_token",
    );
  });

  await t.test("Unauthorized client rejected", async () => {
    await rejectToken(
      await sign({ client_id: "foreign-client" }),
      403,
      "access_denied",
    );
  });

  await t.test("Unauthorized subject rejected", async () => {
    await rejectToken(
      await sign({ sub: "foreign-user" }),
      403,
      "access_denied",
    );
  });

  await t.test("Missing scope rejected", async () => {
    await rejectToken(
      await sign({ scope: undefined }),
      403,
      "insufficient_scope",
    );
  });

  await t.test("Incorrect scope rejected", async () => {
    await rejectToken(
      await sign({ scope: "mobility:write" }),
      403,
      "insufficient_scope",
    );
  });

  await t.test("Partial scope match rejected", async () => {
    await rejectToken(
      await sign({ scope: "mobility:read-all" }),
      403,
      "insufficient_scope",
    );
  });

  await t.test("Key resolver failure denies access", async () => {
    const failingVerifier = createTokenVerifier(
      config,
      async () => {
        throw new Error("JWKS unavailable");
      },
    );

    assert.deepEqual(
      await failingVerifier(`Bearer ${await sign()}`),
      {
        ok: false,
        status: 401,
        error: "invalid_token",
      },
    );
  });

  await t.test("Valid access token accepted", async () => {
    assert.deepEqual(
      await verify(`Bearer ${await sign()}`),
      {
        ok: true,
        subject: config.allowedSubject,
        clientId: config.clientId,
        scopes: ["mobility:read"],
      },
    );
  });

  await t.test("Multiple scopes accepted", async () => {
    const token = await sign({
      scope: "openid mobility:read profile",
    });

    assert.deepEqual(await verify(`Bearer ${token}`), {
      ok: true,
      subject: config.allowedSubject,
      clientId: config.clientId,
      scopes: ["openid", "mobility:read", "profile"],
    });
  });
});
