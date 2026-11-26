import { createServer } from "node:http";

import {
  createMcpHandler,
} from "@modelcontextprotocol/server";

import {
  toNodeHandler,
  localhostHostValidation,
  localhostOriginValidation,
} from "@modelcontextprotocol/node";

import { config } from "./config.ts";
import { createMcpServer } from "./server.ts";

const mcpHandler = createMcpHandler(createMcpServer);
const nodeHandler = toNodeHandler(mcpHandler);

const validateHost = localhostHostValidation();
const validateOrigin = localhostOriginValidation();

const server = createServer(async (req, res) => {
  if (!validateHost(req, res) || !validateOrigin(req, res)) {
    return;
  }

  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");

  try {
    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
      });

      res.end(JSON.stringify({
        service: config.service,
        version: config.version,
        status: "ok",
        mode: config.mode,
      }));

      return;
    }

    if (req.url === "/mcp") {
      await nodeHandler(req, res);
      return;
    }

    res.writeHead(404, {
      "Content-Type": "application/json; charset=utf-8",
    });

    res.end(JSON.stringify({
      error: "Not found",
    }));
  } catch (error) {
    console.error("Request failed:", error);

    if (!res.headersSent) {
      res.writeHead(500, {
        "Content-Type": "application/json; charset=utf-8",
      });

      res.end(JSON.stringify({
        error: "Internal server error",
      }));
    } else {
      res.destroy();
    }
  }
});

server.requestTimeout = 30_000;
server.headersTimeout = 10_000;

server.listen(config.port, config.host, () => {
  const baseUrl = `http://${config.host}:${config.port}`;

  console.log(`${config.service} v${config.version}`);
  console.log(`Mode:   ${config.mode}`);
  console.log(`Health: ${baseUrl}/health`);
  console.log(`MCP:    ${baseUrl}/mcp`);
});

async function shutdown(): Promise<void> {
  console.log("Shutting down...");
  server.close();
  await mcpHandler.close();
}

process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
