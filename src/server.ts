import { McpServer } from "@modelcontextprotocol/server";

import { config } from "./config.ts";

import {
  registerMobilityPing,
} from "./tools/mobility-ping.ts";

import {
  registerSearchPlaces,
} from "./tools/search-places.ts";

import type {
  MobilityProvider,
} from "./providers/types.ts";

export function createMcpServer(
  provider?: MobilityProvider,
): McpServer {
  const server = new McpServer({
    name: config.service,
    version: config.version,
  });

  registerMobilityPing(server);

  if (provider !== undefined) {
    registerSearchPlaces(server, provider);
  }

  return server;
}
