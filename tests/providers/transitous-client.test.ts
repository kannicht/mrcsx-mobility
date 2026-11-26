import assert from "node:assert/strict";
import { test } from "node:test";

import {
  TransitousClient,
} from "../../src/providers/transitous/client.ts";

import {
  loadTransitousConfig,
} from "../../src/providers/transitous/config.ts";

import {
  ProviderError,
} from "../../src/providers/errors.ts";

import type {
  ProviderErrorCode,
} from "../../src/providers/errors.ts";

const env = {
  MOBILITY_TRANSITOUS_BASE_URL:
    "https://transitous.example.test",

  MOBILITY_TRANSITOUS_USER_AGENT:
    "mrcsx-mobility-test/0.3.0",

  MOBILITY_TRANSITOUS_TIMEOUT_MS:
    "1000",
};

const config = loadTransitousConfig(env);

const station = {
  id: "example-station",
  name: "Braunschweig Hauptbahnhof",
  type: "STOP",
  lat: 52.253967,
  lon: 10.538819,
  country: "DE",
  modes: ["BUS", "TRAM"],
};

function jsonResponse(
  body: unknown,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function createClient(response: Response) {
  return new TransitousClient(
    config,
    async () => response,
  );
}

async function expectError(
  client: TransitousClient,
  code: ProviderErrorCode,
  retryable: boolean,
): Promise<void> {
  await assert.rejects(
    () => client.geocode("Braunschweig"),
    (error: unknown) =>
      error instanceof ProviderError &&
      error.code === code &&
      error.retryable === retryable,
  );
}

test("Transitous configuration", async (t) => {
  await t.test("Valid configuration accepted", () => {
    assert.equal(config.timeoutMs, 1000);
    assert.ok(Object.isFrozen(config));
  });

  await t.test("Missing user agent rejected", () => {
    assert.throws(() =>
      loadTransitousConfig({
        ...env,
        MOBILITY_TRANSITOUS_USER_AGENT: undefined,
      }),
    );
  });

  await t.test("HTTP base URL rejected", () => {
    assert.throws(() =>
      loadTransitousConfig({
        ...env,
        MOBILITY_TRANSITOUS_BASE_URL:
          "http://transitous.example.test",
      }),
    );
  });

  await t.test("Invalid timeout rejected", () => {
    assert.throws(() =>
      loadTransitousConfig({
        ...env,
        MOBILITY_TRANSITOUS_TIMEOUT_MS: "-1",
      }),
    );
  });
});

test("Transitous HTTP client", async (t) => {
  await t.test("Request constructed correctly", async () => {
    const client = new TransitousClient(
      config,
      async (input, init) => {
        const url = new URL(String(input));
        const headers = new Headers(init?.headers);

        assert.equal(
          url.origin,
          "https://transitous.example.test",
        );

        assert.equal(url.pathname, "/api/v1/geocode");

        assert.equal(
          url.searchParams.get("text"),
          "Braunschweig Hbf & Süd",
        );

        assert.equal(init?.method, "GET");
        assert.equal(init?.redirect, "error");
        assert.equal(init?.credentials, "omit");

        assert.equal(
          headers.get("user-agent"),
          config.userAgent,
        );

        assert.equal(
          headers.get("accept"),
          "application/json",
        );

        assert.equal(
          headers.has("authorization"),
          false,
        );

        assert.ok(init?.signal);

        return jsonResponse([station]);
      },
    );

    const result = await client.geocode(
      "Braunschweig Hbf & Süd",
    );

    assert.equal(result.length, 1);
    assert.equal(result[0]?.id, station.id);
  });

  await t.test("Empty result accepted", async () => {
    const client = createClient(jsonResponse([]));

    assert.deepEqual(
      await client.geocode("Unknown place"),
      [],
    );
  });

  await t.test("HTTP 429 mapped correctly", async () => {
    await expectError(
      createClient(jsonResponse({}, 429)),
      "RATE_LIMITED",
      true,
    );
  });

  await t.test("HTTP 503 mapped correctly", async () => {
    await expectError(
      createClient(jsonResponse({}, 503)),
      "UNAVAILABLE",
      true,
    );
  });

  await t.test("HTTP 400 mapped correctly", async () => {
    await expectError(
      createClient(jsonResponse({}, 400)),
      "REQUEST_REJECTED",
      false,
    );
  });

  await t.test("Network failure handled", async () => {
    const client = new TransitousClient(
      config,
      async () => {
        throw new TypeError("fetch failed");
      },
    );

    await expectError(
      client,
      "NETWORK_ERROR",
      true,
    );
  });

  await t.test("Unexpected content type rejected", async () => {
    await expectError(
      createClient(new Response("<html>Error</html>")),
      "INVALID_RESPONSE",
      false,
    );
  });

  await t.test("Malformed JSON rejected", async () => {
    await expectError(
      createClient(new Response("{", {
        headers: {
          "Content-Type": "application/json",
        },
      })),
      "INVALID_RESPONSE",
      false,
    );
  });

  await t.test("Invalid response schema rejected", async () => {
    await expectError(
      createClient(jsonResponse([{ name: "Invalid" }])),
      "INVALID_RESPONSE",
      false,
    );
  });

  await t.test("Invalid coordinates rejected", async () => {
    await expectError(
      createClient(jsonResponse([
        { ...station, lat: 999 },
      ])),
      "INVALID_RESPONSE",
      false,
    );
  });

  await t.test("Oversized declared response rejected", async () => {
    const response = new Response("[]", {
      headers: {
        "Content-Type": "application/json",
        "Content-Length": "2000000",
      },
    });

    await expectError(
      createClient(response),
      "INVALID_RESPONSE",
      false,
    );
  });

  await t.test("Oversized streamed response rejected", async () => {
    const response = jsonResponse(
      "x".repeat(config.maxResponseBytes + 1),
    );

    await expectError(
      createClient(response),
      "INVALID_RESPONSE",
      false,
    );
  });

  await t.test("Request timeout handled", async () => {
    const client = new TransitousClient(
      config,
      async (_input, init) => {
        return new Promise<Response>((_resolve, reject) => {
          const timer = setTimeout(() => {
            reject(new Error("Timeout test failed"));
          }, 3000);

          init?.signal?.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              reject(init.signal?.reason);
            },
            { once: true },
          );
        });
      },
    );

    await expectError(client, "TIMEOUT", true);
  });
});
