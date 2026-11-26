import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
} from "jose";

import type { JWTPayload } from "jose";

import {
  loadAuthConfig,
} from "../../src/auth/config.ts";

import {
  createTokenVerifier,
} from "../../src/auth/verifier.ts";

export const testOAuthEnv = {
  MOBILITY_OAUTH_ISSUER: "https://id.example.test",
  MOBILITY_OAUTH_RESOURCE: "https://mobility.example.test/mcp",
  MOBILITY_OAUTH_JWKS_URI: "https://id.example.test/.well-known/jwks.json",
  MOBILITY_OAUTH_SCOPE: "mobility:read",
  MOBILITY_OAUTH_CLIENT_ID: "11111111-1111-4111-8111-111111111111",
  MOBILITY_OAUTH_ALLOWED_SUBJECT: "22222222-2222-4222-8222-222222222222",
};

export async function createOAuthFixture() {
  const authConfig = loadAuthConfig(testOAuthEnv);

  const { publicKey, privateKey } =
    await generateKeyPair("RS256");

  const jwk = {
    ...await exportJWK(publicKey),
    kid: "integration-test-key",
    alg: "RS256",
    use: "sig",
  };

  const jwks = { keys: [jwk] };

  const verifyToken = createTokenVerifier(
    authConfig,
    createLocalJWKSet(jwks),
  );

  async function sign(
    overrides: JWTPayload = {},
  ): Promise<string> {
    const now = Math.floor(Date.now() / 1000);

    return new SignJWT({
      iss: authConfig.issuer,
      aud: authConfig.resource,
      sub: authConfig.allowedSubject,
      client_id: authConfig.clientId,
      scope: authConfig.scope,
      iat: now,
      exp: now + 300,
      ...overrides,
    })
      .setProtectedHeader({
        alg: "RS256",
        typ: "at+jwt",
        kid: jwk.kid,
      })
      .sign(privateKey);
  }

  return {
    authConfig,
    verifyToken,
    jwks,
    sign,
  };
}
