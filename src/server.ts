import { McpServer } from "@modelcontextprotocol/server";
import { config } from "./config.ts";
import { registerMobilityPing } from "./tools/mobility-ping.ts";

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: config.service,
    version: config.version,
  });

  registerMobilityPing(server);

  return server;
}
