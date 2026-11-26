import { createServer } from "node:http";

import { createMcpHandler } from "@modelcontextprotocol/server";

import {
  toNodeHandler,
  hostHeaderValidation,
  originValidation,
} from "@modelcontextprotocol/node";

import { config } from "./config.ts";
import { createMcpServer } from "./server.ts";

import type { AuthConfig } from "./auth/config.ts";

import {
  createTokenVerifier,
} from "./auth/verifier.ts";

import type { TokenVerifier } from "./auth/verifier.ts";

import {
  RESOURCE_METADATA_PATH,
  sendResourceMetadata,
  sendAuthFailure,
} from "./auth/metadata.ts";

export function createHttpServer(
  authConfig: AuthConfig,
  verifyToken: TokenVerifier = createTokenVerifier(authConfig),
) {
  const mcpHandler = createMcpHandler(createMcpServer);
  const nodeHandler = toNodeHandler(mcpHandler);

  const validateHost = hostHeaderValidation([
    ...config.allowedHostnames,
  ]);

  const validateOrigin = originValidation([
    ...config.allowedHostnames,
  ]);

  const server = createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");

    try {
      if (!validateHost(req, res) || !validateOrigin(req, res)) {
        return;
      }

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

      if (
        req.url === RESOURCE_METADATA_PATH &&
        req.method === "GET"
      ) {
        sendResourceMetadata(res, authConfig);
        return;
      }

      if (req.url === "/mcp") {
        const authorization = req.headers.authorization;

        const auth = await verifyToken(authorization);

        if (!auth.ok) {
          sendAuthFailure(
            res,
            authConfig,
            auth,
            authorization !== undefined,
          );

          return;
        }

        await nodeHandler(req, res);
        return;
      }

      res.writeHead(404, {
        "Content-Type": "application/json; charset=utf-8",
      });

      res.end(JSON.stringify({
        error: "Not found",
      }));
    } catch {
      console.error("HTTP request processing failed");

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

  async function close(): Promise<void> {
    await mcpHandler.close();

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });

      server.closeAllConnections();
    });
  }

  return { server, close };
}
