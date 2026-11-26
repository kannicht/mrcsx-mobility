import {
  createRemoteJWKSet,
  jwtVerify,
} from "jose";

import type { JWTVerifyGetKey } from "jose";
import type { AuthConfig } from "./config.ts";

export type AuthResult =
  | {
      ok: true;
      subject: string;
      clientId: string;
      scopes: readonly string[];
    }
  | {
      ok: false;
      status: 401 | 403;
      error:
        | "invalid_token"
        | "access_denied"
        | "insufficient_scope";
    };

export type TokenVerifier = (
  authorization: string | undefined,
) => Promise<AuthResult>;

export function createTokenVerifier(
  config: AuthConfig,
  keyResolver: JWTVerifyGetKey = createRemoteJWKSet(
    new URL(config.jwksUri),
    {
      timeoutDuration: 5_000,
      cooldownDuration: 30_000,
      cacheMaxAge: 600_000,
    },
  ),
): TokenVerifier {
  return async (authorization) => {
    const match = authorization?.match(
      /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i,
    );

    const token = match?.[1];

    if (!token || token.length > 16_384) {
      return {
        ok: false,
        status: 401,
        error: "invalid_token",
      };
    }

    try {
      const { payload } = await jwtVerify(
        token,
        keyResolver,
        {
          algorithms: ["RS256"],
          typ: "at+jwt",
          issuer: config.issuer,
          audience: config.resource,
          requiredClaims: [
            "iss",
            "aud",
            "exp",
            "iat",
            "sub",
            "client_id",
          ],
          clockTolerance: 0,
        },
      );

      if (
        typeof payload.iat !== "number" ||
        payload.iat > Math.floor(Date.now() / 1000)
      ) {
        return {
          ok: false,
          status: 401,
          error: "invalid_token",
        };
      }

      if (
        payload.client_id !== config.clientId ||
        payload.sub !== config.allowedSubject
      ) {
        return {
          ok: false,
          status: 403,
          error: "access_denied",
        };
      }

      const scopes =
        typeof payload.scope === "string"
          ? payload.scope.split(" ").filter(Boolean)
          : [];

      if (!scopes.includes(config.scope)) {
        return {
          ok: false,
          status: 403,
          error: "insufficient_scope",
        };
      }

      return {
        ok: true,
        subject: config.allowedSubject,
        clientId: config.clientId,
        scopes: Object.freeze(scopes),
      };
    } catch {
      return {
        ok: false,
        status: 401,
        error: "invalid_token",
      };
    }
  };
}
