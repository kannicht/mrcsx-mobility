import * as z from "zod/v4";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";

import { config } from "../src/config.ts";
import { createHttpServer } from "../src/http-server.ts";
import { createOAuthFixture } from "./helpers/oauth.ts";

import {
  TransitousProvider,
} from "../src/providers/transitous/provider.ts";

import {
  transitousGeocodeResponseSchema,
} from "../src/providers/transitous/schemas.ts";

import {
  searchPlacesResultSchema,
} from "../src/providers/types.ts";

import {
  ProviderError,
} from "../src/providers/errors.ts";

const pingResultSchema = z.strictObject({
  service: z.literal(config.service),
  version: z.literal(config.version),
  status: z.literal("ok"),
  mode: z.literal("live"),
  timestamp: z.iso.datetime(),
  nonce: z.string().nullable(),
});

test("MCP integration", { timeout: 30_000 }, async (t) => {
  const fixture = await createOAuthFixture();

  let providerCalls = 0;
  let providerNow = 0;

  const provider = new TransitousProvider({
    async geocode(query) {
      providerCalls++;

      if (query === "Provider failure") {
        throw new ProviderError(
          "UNAVAILABLE",
          "Transitous is temporarily unavailable",
          true,
        );
      }

      if (query === "Unknown place") {
        return [];
      }

      return transitousGeocodeResponseSchema.parse([
        {
          id: "station-1",
          name: "Braunschweig Hauptbahnhof",
          type: "STOP",
          lat: 52.253967,
          lon: 10.538819,
          country: "DE",
          modes: ["BUS", "TRAM"],
        },
      ]);
    },
  }, () => providerNow);

  const { server, close } = createHttpServer(
    fixture.authConfig,
    fixture.verifyToken,
    provider,
  );

  const token = await fixture.sign();

  const client = new Client({
    name: "mrcsx-mobility-test",
    version: config.version,
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();

  assert.ok(address && typeof address !== "string");

  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await t.test("Health endpoint", async () => {
      const response = await fetch(`${baseUrl}/health`);

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        service: config.service,
        version: config.version,
        status: "ok",
        mode: "live",
      });
    });

    await t.test("MCP connection", async () => {
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
    });

    await t.test("Tool discovery", async () => {
      const { tools } = await client.listTools();

      assert.deepEqual(
        tools.map((tool) => tool.name).sort(),
        ["mobility_ping", "mobility_search_places"],
      );

      for (const tool of tools) {
        assert.equal(
          tool.annotations?.readOnlyHint,
          true,
        );
      }

      const search = tools.find(
        tool => tool.name === "mobility_search_places",
      );

      assert.ok(search?.inputSchema);
      assert.ok(search.outputSchema);
      assert.equal(search.annotations?.openWorldHint, true);
    });

    await t.test("Ping with nonce", async () => {
      const nonce = randomUUID();
      const before = Date.now();

      const result = await client.callTool({
        name: "mobility_ping",
        arguments: { nonce },
      });

      assert.notEqual(result.isError, true);

      const data = pingResultSchema.parse(result.structuredContent);

      assert.ok(data);
      assert.equal(data.service, config.service);
      assert.equal(data.version, config.version);
      assert.equal(data.status, "ok");
      assert.equal(data.mode, "live");
      assert.equal(data.nonce, nonce);

      assert.ok(typeof data.timestamp === "string");

      const timestamp = Date.parse(data.timestamp);

      assert.ok(Number.isFinite(timestamp));
      assert.ok(timestamp >= before);
      assert.ok(timestamp <= Date.now());
      assert.equal(
        new Date(timestamp).toISOString(),
        data.timestamp,
      );
    });

    await t.test("Ping without nonce", async () => {
      const result = await client.callTool({
        name: "mobility_ping",
        arguments: {},
      });

      assert.notEqual(result.isError, true);
      assert.equal(
        pingResultSchema.parse(result.structuredContent).nonce,
        null,
      );
    });

    await t.test("Invalid nonce rejected", async () => {
      const result = await client.callTool({
        name: "mobility_ping",
        arguments: { nonce: 123 },
      });

      assert.equal(result.isError, true);
    });

    await t.test("Search public transport stops", async () => {
      const result = await client.callTool({
        name: "mobility_search_places",
        arguments: {
          query: "Braunschweig Hauptbahnhof",
          type: "stop",
          limit: 5,
        },
      });

      assert.notEqual(result.isError, true);

      const data = searchPlacesResultSchema.parse(
        result.structuredContent,
      );

      assert.equal(data.provider, "transitous");
      assert.equal(data.results.length, 1);
      assert.equal(data.results[0]?.id, "station-1");
      assert.equal(data.results[0]?.type, "stop");
      assert.equal(providerCalls, 1);
    });

    await t.test("Cache shared across MCP calls", async () => {
      const result = await client.callTool({
        name: "mobility_search_places",
        arguments: {
          query: "Braunschweig Hauptbahnhof",
          type: "all",
          limit: 1,
        },
      });

      assert.notEqual(result.isError, true);
      assert.equal(providerCalls, 1);
    });

    await t.test("Default search parameters accepted", async () => {
      const result = await client.callTool({
        name: "mobility_search_places",
        arguments: {
          query: "Braunschweig Hauptbahnhof",
        },
      });

      assert.notEqual(result.isError, true);

      const data = searchPlacesResultSchema.parse(
        result.structuredContent,
      );

      assert.equal(data.results.length, 1);
      assert.equal(providerCalls, 1);
    });

    await t.test("Invalid search arguments rejected", async () => {
      for (const args of [
        { query: "a" },
        { query: "Braunschweig", limit: 100 },
        { query: "Braunschweig", type: "invalid" },
        { query: "Braunschweig", unexpected: true },
      ]) {
        const result = await client.callTool({
          name: "mobility_search_places",
          arguments: args,
        });

        assert.equal(result.isError, true);
      }

      assert.equal(providerCalls, 1);
    });

    await t.test("Empty search result accepted", async () => {
      providerNow += 1000;

      const result = await client.callTool({
        name: "mobility_search_places",
        arguments: {
          query: "Unknown place",
        },
      });

      assert.notEqual(result.isError, true);

      const data = searchPlacesResultSchema.parse(
        result.structuredContent,
      );

      assert.deepEqual(data.results, []);
      assert.equal(providerCalls, 2);
    });

    await t.test("Provider failure returned as tool error", async () => {
      providerNow += 1000;

      const result = await client.callTool({
        name: "mobility_search_places",
        arguments: {
          query: "Provider failure",
        },
      });

      assert.equal(result.isError, true);
      assert.equal(providerCalls, 3);

      const content = z.array(
        z.object({
          type: z.literal("text"),
          text: z.string(),
        }),
      ).parse(result.content);

      assert.deepEqual(
        JSON.parse(content[0]!.text),
        {
          code: "UNAVAILABLE",
          message: "Transitous is temporarily unavailable",
          retryable: true,
        },
      );
    });

    await t.test("Local rate limit returned as tool error", async () => {
      const result = await client.callTool({
        name: "mobility_search_places",
        arguments: {
          query: "Celle Bahnhof",
        },
      });

      assert.equal(result.isError, true);
      assert.equal(providerCalls, 3);
    });

    await t.test("Unknown HTTP route", async () => {
      const response = await fetch(
        `${baseUrl}/nonexistent`,
      );

      assert.equal(response.status, 404);
    });
  } finally {
    try {
      await client.close();
    } finally {
      await close();
    }
  }
});
