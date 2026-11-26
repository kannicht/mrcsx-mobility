const port = Number(process.env.MOBILITY_PORT ?? "3100");

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("Invalid MOBILITY_PORT");
}

export const config = {
  service: "mrcsx-mobility",
  version: "0.3.0",
  mode: "live",
  host: process.env.MOBILITY_HOST ?? "127.0.0.1",
  port,
  allowedHostnames: [
    "localhost",
    "127.0.0.1",
    "[::1]",
    ...(process.env.MOBILITY_PUBLIC_HOST
      ? [process.env.MOBILITY_PUBLIC_HOST]
      : []),
  ],
} as const;
