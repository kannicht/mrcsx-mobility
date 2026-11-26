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

import {
  searchPlacesResultSchema,
} from "../../src/providers/types.ts";

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
  mode: "live",
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
    tools.map((tool) => tool.name).sort(),
    ["mobility_ping", "mobility_search_places"],
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

  const search = await client.callTool({
    name: "mobility_search_places",
    arguments: {
      query: "Braunschweig Hauptbahnhof",
      type: "stop",
      limit: 5,
    },
  });

  assert.notEqual(search.isError, true);

  const searchData = searchPlacesResultSchema.parse(
    search.structuredContent,
  );

  assert.equal(searchData.provider, "transitous");
  assert.equal(searchData.results.length, 1);

  const station = searchData.results[0]!;

  assert.equal(station.id, "fixture-stop-1");
  assert.equal(station.type, "stop");
  assert.equal(station.locality, "Braunschweig");
  assert.equal(station.region, "Niedersachsen");
  assert.equal(station.timezone, "Europe/Berlin");
  assert.ok(station.modes.includes("REGIONAL_RAIL"));

  console.log("PASS: Authenticated mobility_search_places");

  const cached = await client.callTool({
    name: "mobility_search_places",
    arguments: {
      query: "Braunschweig Hauptbahnhof",
      type: "all",
      limit: 10,
    },
  });

  assert.notEqual(cached.isError, true);

  const cachedData = searchPlacesResultSchema.parse(
    cached.structuredContent,
  );

  assert.equal(cachedData.results.length, 2);
  assert.equal(cachedData.results[0]?.type, "stop");
  assert.equal(cachedData.results[1]?.type, "place");

  console.log("PASS: Cached search with different filter");

  // Allow the local request interval to elapse so invalid
  // arguments cannot pass this test merely due to rate limiting.
  await new Promise(resolve => setTimeout(resolve, 1100));

  for (const args of [
    { query: "a" },
    { query: "Invalid limit", limit: 100 },
    { query: "Invalid type", type: "unknown" },
    { query: "Unexpected field", extra: true },
  ]) {
    const invalidSearch = await client.callTool({
      name: "mobility_search_places",
      arguments: args,
    });

    assert.equal(invalidSearch.isError, true);
  }

  console.log("PASS: Invalid search arguments rejected");

  const failure = await client.callTool({
    name: "mobility_search_places",
    arguments: {
      query: "Provider failure",
    },
  });

  assert.equal(failure.isError, true);

  const failureContent = z.array(
    z.object({
      type: z.literal("text"),
      text: z.string(),
    }),
  ).parse(failure.content);

  assert.deepEqual(
    JSON.parse(failureContent[0]!.text),
    {
      code: "UNAVAILABLE",
      message: "Transitous is temporarily unavailable",
      retryable: true,
    },
  );

  console.log("PASS: Provider failure handled safely");

} finally {
  await client.close();
}

console.log("All Docker smoke tests passed");
