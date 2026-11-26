import assert from "node:assert/strict";
import { test } from "node:test";

import {
  TransitousProvider,
} from "../../src/providers/transitous/provider.ts";

import {
  ProviderError,
} from "../../src/providers/errors.ts";

import {
  searchPlacesInputSchema,
} from "../../src/providers/types.ts";

import {
  transitousGeocodeResponseSchema,
} from "../../src/providers/transitous/schemas.ts";

import type {
  TransitousPlace,
} from "../../src/providers/transitous/schemas.ts";

const station = transitousGeocodeResponseSchema.parse([
  {
    id: "station-1",
    name: "Braunschweig Hauptbahnhof",
    type: "STOP",
    lat: 52.253967,
    lon: 10.538819,
    modes: ["BUS", "TRAM"],
  },
]);

function input(overrides = {}) {
  return searchPlacesInputSchema.parse({
    query: "Braunschweig Hauptbahnhof",
    ...overrides,
  });
}

function fixture(
  geocode: (
    query: string,
  ) => Promise<TransitousPlace[]> =
    async () => station,
) {
  let now = 0;
  let calls = 0;

  const provider = new TransitousProvider({
    async geocode(query) {
      calls++;
      return geocode(query);
    },
  }, () => now);

  return {
    provider,
    calls: () => calls,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

test("Transitous provider", async (t) => {
  await t.test("Search results normalized", async () => {
    const { provider } = fixture();

    const result = await provider.searchPlaces(input());

    assert.equal(result.provider, "transitous");
    assert.equal(result.results[0]?.type, "stop");
    assert.equal(result.results[0]?.id, "station-1");
  });

  await t.test("Repeated query uses cache", async () => {
    const { provider, calls } = fixture();

    await provider.searchPlaces(input());
    await provider.searchPlaces(input());

    assert.equal(calls(), 1);
  });

  await t.test("Cache reused across filters", async () => {
    const { provider, calls } = fixture();

    await provider.searchPlaces(input());

    const result = await provider.searchPlaces(
      input({ type: "address", limit: 1 }),
    );

    assert.deepEqual(result.results, []);
    assert.equal(calls(), 1);
  });

  await t.test("Whitespace normalized", async () => {
    const { provider, calls } = fixture();

    await provider.searchPlaces(input());

    await provider.searchPlaces(input({
      query: "Braunschweig   Hauptbahnhof",
    }));

    assert.equal(calls(), 1);
  });

  await t.test("Cache expires after 15 minutes", async () => {
    const { provider, calls, advance } = fixture();

    await provider.searchPlaces(input());

    advance(15 * 60 * 1000);

    await provider.searchPlaces(input());

    assert.equal(calls(), 2);
  });

  await t.test("Empty results cached", async () => {
    const { provider, calls } = fixture(
      async () => [],
    );

    await provider.searchPlaces(input());
    await provider.searchPlaces(input());

    assert.equal(calls(), 1);
  });

  await t.test("Concurrent duplicate queries merged", async () => {
    const { provider, calls } = fixture();

    const [first, second] = await Promise.all([
      provider.searchPlaces(input()),
      provider.searchPlaces(input()),
    ]);

    assert.deepEqual(first, second);
    assert.equal(calls(), 1);
  });

  await t.test("Minimum request interval enforced", async () => {
    const { provider, calls } = fixture();

    await provider.searchPlaces(input());

    await assert.rejects(
      () => provider.searchPlaces(
        input({ query: "Celle Bahnhof" }),
      ),
      (error: unknown) =>
        error instanceof ProviderError &&
        error.code === "RATE_LIMITED",
    );

    assert.equal(calls(), 1);
  });

  await t.test("New request allowed after interval", async () => {
    const { provider, calls, advance } = fixture();

    await provider.searchPlaces(input());

    advance(1000);

    await provider.searchPlaces(
      input({ query: "Celle Bahnhof" }),
    );

    assert.equal(calls(), 2);
  });

  await t.test("Concurrent request limit enforced", async () => {
    let release!: () => void;

    const gate = new Promise<void>(resolve => {
      release = resolve;
    });

    const { provider, calls, advance } = fixture(
      async () => {
        await gate;
        return station;
      },
    );

    const first = provider.searchPlaces(input());

    advance(1000);

    const second = provider.searchPlaces(
      input({ query: "Celle Bahnhof" }),
    );

    try {
      advance(1000);

      await assert.rejects(
        () => provider.searchPlaces(
          input({ query: "Hannover Hauptbahnhof" }),
        ),
        (error: unknown) =>
          error instanceof ProviderError &&
          error.code === "BUSY",
      );
    } finally {
      release();

      await Promise.all([first, second]);
    }

    assert.equal(calls(), 2);
  });

  await t.test("Failures not cached", async () => {
    let attempt = 0;

    const { provider, calls, advance } = fixture(
      async () => {
        if (attempt++ === 0) {
          throw new ProviderError(
            "UNAVAILABLE",
            "Test failure",
            true,
          );
        }

        return station;
      },
    );

    await assert.rejects(
      () => provider.searchPlaces(input()),
    );

    advance(1000);

    const result = await provider.searchPlaces(input());

    assert.equal(result.results.length, 1);
    assert.equal(calls(), 2);
  });
});
