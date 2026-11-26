import * as z from "zod/v4";

const transitousConfigSchema = z.strictObject({
  baseUrl: z.string().url().refine(value => {
    const url = new URL(value);

    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/"
    );
  }),

  userAgent: z.string()
    .trim()
    .min(10)
    .max(256)
    .regex(/^[\x20-\x7E]+$/),

  timeoutMs: z.number()
    .int()
    .min(1000)
    .max(15000),

  maxResponseBytes: z.number()
    .int()
    .min(1024)
    .max(4194304),
});

export type TransitousConfig = Readonly<
  z.infer<typeof transitousConfigSchema>
>;

export function loadTransitousConfig(
  env: NodeJS.ProcessEnv = process.env,
): TransitousConfig {
  const result = transitousConfigSchema.safeParse({
    baseUrl:
      env.MOBILITY_TRANSITOUS_BASE_URL
      ?? "https://api.transitous.org",

    userAgent:
      env.MOBILITY_TRANSITOUS_USER_AGENT,

    timeoutMs: Number(
      env.MOBILITY_TRANSITOUS_TIMEOUT_MS ?? "5000",
    ),

    maxResponseBytes: 1048576,
  });

  if (!result.success) {
    const fields = result.error.issues
      .map(issue => issue.path.join("."))
      .join(", ");

    throw new Error(
      `Invalid Transitous configuration: ${fields}`,
    );
  }

  return Object.freeze(result.data);
}
