import assert from "node:assert/strict";
import { test } from "node:test";

import {
  transitousPlaceSchema,
  transitousGeocodeResponseSchema,
} from "../../src/providers/transitous/schemas.ts";

import {
  mapTransitousPlace,
  mapTransitousSearchResults,
} from "../../src/providers/transitous/mapper.ts";

import {
  mobilityPlaceSchema,
  searchPlacesInputSchema,
} from "../../src/providers/types.ts";

import {
  TransitousClient,
} from "../../src/providers/transitous/client.ts";

import {
  loadTransitousConfig,
} from "../../src/providers/transitous/config.ts";

const address = {
  type: "ADDRESS",
  id: "",
  name: "Bohlweg 1",
  lat: 52.2623106,
  lon: 10.5251537,
  street: "Bohlweg",
  houseNumber: "1",
  country: "DE",
  zip: "38100",
  tz: "Europe/Berlin",
  areas: [
    {
      name: "Niedersachsen",
      adminLevel: 4,
    },
    {
      name: "Braunschweig",
      adminLevel: 6,
      default: true,
    },
  ],
};

const secondAddress = {
  ...address,
  name: "Bohlweg 10",
  houseNumber: "10",
  lat: 52.2630181,
  lon: 10.5257673,
};

const station = {
  type: "STOP",
  id: "fixture-stop-1",
  name: "Braunschweig, Sachsendamm",
  lat: 52.23,
  lon: 10.54,
  modes: ["BUS"],
};

test("Transitous address regression tests", async (t) => {
  await t.test("Empty address ID accepted", () => {
    const raw = transitousPlaceSchema.parse(address);

    assert.equal(raw.id, "");
  });

  await t.test("Missing address ID accepted", () => {
    const { id, ...withoutId } = address;

    const raw = transitousPlaceSchema.parse(withoutId);

    assert.equal(raw.id, "");
  });

  await t.test("Address ID normalized to null", () => {
    const raw = transitousPlaceSchema.parse(address);

    assert.equal(mapTransitousPlace(raw).id, null);
  });

  await t.test("Street and house number preserved", () => {
    const raw = transitousPlaceSchema.parse(address);
    const result = mapTransitousPlace(raw);

    assert.equal(result.street, "Bohlweg");
    assert.equal(result.houseNumber, "1");
    assert.equal(result.locality, "Braunschweig");
    assert.equal(result.latitude, address.lat);
    assert.equal(result.longitude, address.lon);
  });

  await t.test("Street without house number accepted", () => {
    const raw = transitousPlaceSchema.parse({
      ...address,
      name: "Sachsendamm",
      street: "Sachsendamm",
      houseNumber: undefined,
    });

    assert.equal(
      mapTransitousPlace(raw).houseNumber,
      undefined,
    );
  });

  await t.test("Empty stop ID rejected", () => {
    assert.equal(
      transitousPlaceSchema.safeParse({
        ...station,
        id: "",
      }).success,
      false,
    );
  });

  await t.test("Missing stop ID rejected", () => {
    const { id, ...withoutId } = station;

    assert.equal(
      transitousPlaceSchema.safeParse(withoutId).success,
      false,
    );
  });

  await t.test("Empty place ID rejected", () => {
    assert.equal(
      transitousPlaceSchema.safeParse({
        ...station,
        type: "PLACE",
        id: "",
      }).success,
      false,
    );
  });

  await t.test("Normalized stop cannot have null ID", () => {
    const raw = transitousPlaceSchema.parse(station);

    assert.equal(
      mobilityPlaceSchema.safeParse({
        ...mapTransitousPlace(raw),
        id: null,
      }).success,
      false,
    );
  });

  await t.test("Distinct addresses are preserved", () => {
    const raw = transitousGeocodeResponseSchema.parse([
      address,
      secondAddress,
    ]);

    const result = mapTransitousSearchResults(
      raw,
      searchPlacesInputSchema.parse({
        query: "Braunschweig Bohlweg 1",
        type: "address",
      }),
    );

    assert.equal(result.results.length, 2);
    assert.deepEqual(
      result.results.map(place => place.houseNumber),
      ["1", "10"],
    );
  });

  await t.test("Identical addresses deduplicated", () => {
    const raw = transitousGeocodeResponseSchema.parse([
      address,
      address,
    ]);

    const result = mapTransitousSearchResults(
      raw,
      searchPlacesInputSchema.parse({
        query: "Braunschweig Bohlweg 1",
      }),
    );

    assert.equal(result.results.length, 1);
  });

  await t.test("Mixed stop and address HTTP response accepted", async () => {
    const config = loadTransitousConfig({
      MOBILITY_TRANSITOUS_USER_AGENT:
        "mrcsx-mobility-test/0.3.0",
    });

    const client = new TransitousClient(
      config,
      async () => new Response(
        JSON.stringify([station, address]),
        {
          headers: {
            "Content-Type": "application/json",
          },
        },
      ),
    );

    const raw = await client.geocode(
      "Braunschweig Sachsendamm",
    );

    const result = mapTransitousSearchResults(
      raw,
      searchPlacesInputSchema.parse({
        query: "Braunschweig Sachsendamm",
        type: "stop",
      }),
    );

    assert.equal(result.results.length, 1);
    assert.equal(result.results[0]?.id, station.id);
  });
});
