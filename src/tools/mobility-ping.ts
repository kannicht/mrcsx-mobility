import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { config } from "../config.ts";

export function registerMobilityPing(server: McpServer): void {
  server.registerTool(
    "mobility_ping",
    {
      title: "Mobility connectivity check",
      description:
        "Checks the mobility service and echoes an optional nonce. " +
        "Does not access real public transport data.",

      inputSchema: z.object({
        nonce: z.string().optional(),
      }),

      outputSchema: z.object({
        service: z.literal(config.service),
        version: z.literal(config.version),
        status: z.literal("ok"),
        mode: z.literal(config.mode),
        timestamp: z.iso.datetime(),
        nonce: z.string().nullable(),
      }),

      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ nonce }) => {
      const result = {
        service: config.service,
        version: config.version,
        status: "ok" as const,
        mode: config.mode,
        timestamp: new Date().toISOString(),
        nonce: nonce ?? null,
      };

      return {
        structuredContent: result,
        content: [
          {
            type: "text",
            text: JSON.stringify(result),
          },
        ],
      };
    },
  );
}
