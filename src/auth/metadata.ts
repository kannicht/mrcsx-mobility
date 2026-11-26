import type { ServerResponse } from "node:http";
import type { AuthConfig } from "./config.ts";
import type { AuthResult } from "./verifier.ts";

export const RESOURCE_METADATA_PATH =
  "/.well-known/oauth-protected-resource/mcp";

export function resourceMetadataUrl(
  config: AuthConfig,
): string {
  return new URL(
    RESOURCE_METADATA_PATH,
    config.resource,
  ).href;
}

export function createResourceMetadata(
  config: AuthConfig,
) {
  return {
    resource: config.resource,
    authorization_servers: [config.issuer],
    scopes_supported: [config.scope],
    bearer_methods_supported: ["header"],
    resource_name: "mrcsx Mobility",
  };
}

export function sendResourceMetadata(
  res: ServerResponse,
  config: AuthConfig,
): void {
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });

  res.end(
    JSON.stringify(createResourceMetadata(config)),
  );
}

export function sendAuthFailure(
  res: ServerResponse,
  config: AuthConfig,
  failure: Extract<AuthResult, { ok: false }>,
  hasAuthorization: boolean,
): void {
  const challenge = [
    'realm="mrcsx-mobility"',
    `resource_metadata="${resourceMetadataUrl(config)}"`,
    `scope="${config.scope}"`,
  ];

  if (
    hasAuthorization &&
    failure.error !== "access_denied"
  ) {
    challenge.push(`error="${failure.error}"`);
  }

  res.writeHead(failure.status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "WWW-Authenticate": `Bearer ${challenge.join(", ")}`,
  });

  res.end(JSON.stringify({
    error: !hasAuthorization
      ? "unauthorized"
      : failure.error,
  }));
}
