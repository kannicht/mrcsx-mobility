import * as z from "zod/v4";

const httpsUrl = z.string().url().refine(
  (value) => {
    const url = new URL(value);

    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  },
  { message: "Expected an absolute HTTPS URL" },
);

const authConfigSchema = z.strictObject({
  issuer: httpsUrl,
  resource: httpsUrl,
  jwksUri: httpsUrl,
  scope: z.literal("mobility:read"),
  clientId: z.uuid(),
  allowedSubject: z.uuid(),
});

export type AuthConfig = Readonly<
  z.infer<typeof authConfigSchema>
>;

export function loadAuthConfig(
  env: NodeJS.ProcessEnv = process.env,
): AuthConfig {
  const result = authConfigSchema.safeParse({
    issuer: env.MOBILITY_OAUTH_ISSUER,
    resource: env.MOBILITY_OAUTH_RESOURCE,
    jwksUri: env.MOBILITY_OAUTH_JWKS_URI,
    scope: env.MOBILITY_OAUTH_SCOPE,
    clientId: env.MOBILITY_OAUTH_CLIENT_ID,
    allowedSubject: env.MOBILITY_OAUTH_ALLOWED_SUBJECT,
  });

  if (!result.success) {
    const fields = result.error.issues
      .map((issue) => issue.path.join("."))
      .join(", ");

    throw new Error(
      `Invalid or missing OAuth configuration: ${fields}`,
    );
  }

  const config = result.data;
  const issuer = new URL(config.issuer);
  const resource = new URL(config.resource);
  const jwks = new URL(config.jwksUri);

  if (jwks.origin !== issuer.origin) {
    throw new Error(
      "OAuth JWKS URI must belong to the configured issuer",
    );
  }

  if (resource.pathname !== "/mcp") {
    throw new Error(
      "OAuth resource must identify the /mcp endpoint",
    );
  }

  return Object.freeze(config);
}
