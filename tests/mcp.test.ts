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

const pingResultSchema = z.strictObject({
  service: z.literal(config.service),
  version: z.literal(config.version),
  status: z.literal("ok"),
  mode: z.literal("mock"),
  timestamp: z.iso.datetime(),
  nonce: z.string().nullable(),
});

test("MCP integration", { timeout: 30_000 }, async (t) => {
  const fixture = await createOAuthFixture();

  const { server, close } = createHttpServer(
    fixture.authConfig,
    fixture.verifyToken,
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
        mode: "mock",
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
        tools.map((tool) => tool.name),
        ["mobility_ping"],
      );

      assert.equal(
        tools[0]?.annotations?.readOnlyHint,
        true,
      );
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
      assert.equal(data.mode, "mock");
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
