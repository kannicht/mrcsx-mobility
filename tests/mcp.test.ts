import * as z from "zod/v4";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";

import { config } from "../src/config.ts";

const pingResultSchema = z.strictObject({
  service: z.literal(config.service),
  version: z.literal(config.version),
  status: z.literal("ok"),
  mode: z.literal("mock"),
  timestamp: z.iso.datetime(),
  nonce: z.string().nullable(),
});

test("MCP integration", { timeout: 30_000 }, async (t) => {
  const server = spawn(process.execPath, ["src/index.ts"], {
    stdio: ["ignore", "pipe", "inherit"],
  });

  const baseUrl = `http://${config.host}:${config.port}`;

  const client = new Client({
    name: "mrcsx-mobility-test",
    version: "0.1.0",
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("Server startup timed out"));
      }, 5000);

      let output = "";

      server.stdout.on("data", (chunk) => {
        output += chunk.toString();

        if (output.includes("MCP:")) {
          clearTimeout(timer);
          resolve();
        }
      });

      server.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });

      server.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`Server exited: ${code}`));
      });
    });

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
      server.kill("SIGTERM");
    }
  }
});
