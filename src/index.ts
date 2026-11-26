import { config } from "./config.ts";
import { loadAuthConfig } from "./auth/config.ts";
import { createHttpServer } from "./http-server.ts";

const authConfig = loadAuthConfig();

const { server, close } = createHttpServer(authConfig);

server.listen(config.port, config.host, () => {
  const baseUrl = `http://${config.host}:${config.port}`;

  console.log(`${config.service} v${config.version}`);
  console.log(`Mode:   ${config.mode}`);
  console.log("Auth:   OAuth 2.0 required");
  console.log(`Issuer: ${authConfig.issuer}`);
  console.log(`Health: ${baseUrl}/health`);
  console.log(`MCP:    ${baseUrl}/mcp`);
});

let shuttingDown = false;

async function shutdown(): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  console.log("Shutting down...");

  try {
    await close();
  } catch {
    console.error("Server shutdown failed");
    process.exitCode = 1;
  }
}

process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
