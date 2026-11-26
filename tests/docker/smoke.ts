import * as z from "zod/v4";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";

import { config } from "../../src/config.ts";

const directory = process.argv[2];
const baseUrl = process.argv[3];

if (!directory || !baseUrl) {
  throw new Error("Missing fixture directory or base URL");
}

const token = await readFile(
  join(directory, "token"),
  "utf8",
);

const invalidScopeToken = await readFile(
  join(directory, "invalid-scope-token"),
  "utf8",
);

const health = await fetch(`${baseUrl}/health`);

assert.equal(health.status, 200);
assert.deepEqual(await health.json(), {
  service: config.service,
  version: config.version,
  status: "ok",
  mode: "mock",
});

console.log("PASS: Health endpoint");

const metadata = await fetch(
  `${baseUrl}/.well-known/oauth-protected-resource/mcp`,
);

assert.equal(metadata.status, 200);

assert.deepEqual(await metadata.json(), {
  resource: "https://mobility.example.test/mcp",
  authorization_servers: [
    "https://oauth-fixture:3443",
  ],
  scopes_supported: ["mobility:read"],
  bearer_methods_supported: ["header"],
  resource_name: "mrcsx Mobility",
});

console.log("PASS: OAuth discovery");

for (const method of ["GET", "POST", "DELETE"]) {
  const response = await fetch(`${baseUrl}/mcp`, {
    method,
  });

  assert.equal(response.status, 401);

  assert.ok(
    response.headers.get("www-authenticate")
      ?.includes("resource_metadata="),
  );

  console.log(`PASS: Unauthenticated ${method} rejected`);
}

const invalid = await fetch(`${baseUrl}/mcp`, {
  method: "POST",
  headers: {
    Authorization: "Bearer invalid.token.value",
  },
});

assert.equal(invalid.status, 401);

console.log("PASS: Invalid token rejected");

const forbidden = await fetch(`${baseUrl}/mcp`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${invalidScopeToken}`,
  },
});

assert.equal(forbidden.status, 403);

assert.ok(
  forbidden.headers.get("www-authenticate")
    ?.includes('error="insufficient_scope"'),
);

console.log("PASS: Missing scope rejected");

const client = new Client({
  name: "mobility-docker-test",
  version: config.version,
});

try {
  await client.connect(
    new StreamableHTTPClientTransport(
      new URL(`${baseUrl}/mcp`),
      {
        requestInit: {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      },
    ),
  );

  console.log("PASS: Authenticated MCP connection");

  const { tools } = await client.listTools();

  assert.deepEqual(
    tools.map((tool) => tool.name),
    ["mobility_ping"],
  );

  console.log("PASS: Tool discovery");

  const nonce = randomUUID();

  const result = await client.callTool({
    name: "mobility_ping",
    arguments: { nonce },
  });

  assert.notEqual(result.isError, true);

  const data = z.strictObject({
    service: z.literal(config.service),
    version: z.literal(config.version),
    status: z.literal("ok"),
    mode: z.literal(config.mode),
    timestamp: z.iso.datetime(),
    nonce: z.string().nullable(),
  }).parse(result.structuredContent);

  assert.equal(data.nonce, nonce);

  console.log("PASS: Authenticated mobility_ping");
} finally {
  await client.close();
}

console.log("All Docker smoke tests passed");
