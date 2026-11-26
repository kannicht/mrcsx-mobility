import assert from "node:assert/strict";
import { test } from "node:test";

import {
  transitousPlaceSchema,
} from "../../src/providers/transitous/schemas.ts";

import {
  mapTransitousPlace,
  mapTransitousSearchResults,
} from "../../src/providers/transitous/mapper.ts";

import {
  searchPlacesInputSchema,
} from "../../src/providers/types.ts";

const station = transitousPlaceSchema.parse({
  id: "de-DELFI_de:03101:178:6:H",
  name: "Braunschweig Hauptbahnhof",
  type: "STOP",
  lat: 52.253967,
  lon: 10.538819,
  country: "DE",
  zip: "38102",
  tz: "Europe/Berlin",

  areas: [
    {
      name: "Deutschland",
      adminLevel: 2,
    },
    {
      name: "Niedersachsen",
      adminLevel: 4,
    },
    {
      name: "Braunschweig",
      adminLevel: 6,
      default: true,
    },
    {
      name: "Mitte",
      adminLevel: 9,
    },
  ],

  modes: [
    "HIGHSPEED_RAIL",
    "LONG_DISTANCE",
    "REGIONAL_RAIL",
    "TRAM",
    "BUS",
  ],
});

const building = transitousPlaceSchema.parse({
  id: "way/1432591501",
  name: "Braunschweig Hauptbahnhof",
  type: "PLACE",
  lat: 52.2530358,
  lon: 10.5400307,
  country: "DE",
  areas: station.areas,
});

const secondStop = transitousPlaceSchema.parse({
  ...station,
  id: "de-VBN_000120177001",
  name: "Braunschweig Hauptbahnhof Süd",
  modes: ["BUS"],
});

test("Transitous place normalization", async (t) => {
  await t.test("Station fields preserved", () => {
    const result = mapTransitousPlace(station);

    assert.deepEqual(result, {
      id: station.id,
      name: station.name,
      type: "stop",
      latitude: station.lat,
      longitude: station.lon,
      countryCode: "DE",
      postalCode: "38102",
      street: undefined,
      houseNumber: undefined,
      timezone: "Europe/Berlin",
      locality: "Braunschweig",
      region: "Niedersachsen",
      modes: station.modes,
    });
  });

  await t.test("Place type normalized", () => {
    assert.equal(
      mapTransitousPlace(building).type,
      "place",
    );
  });

  await t.test("Address type normalized", () => {
    const address = transitousPlaceSchema.parse({
      ...building,
      type: "ADDRESS",
    });

    assert.equal(
      mapTransitousPlace(address).type,
      "address",
    );
  });

  await t.test("Missing optional metadata accepted", () => {
    const raw = transitousPlaceSchema.parse({
      id: "minimal-place",
      name: "Example",
      type: "PLACE",
      lat: 52,
      lon: 10,
    });

    const result = mapTransitousPlace(raw);

    assert.equal(result.locality, undefined);
    assert.equal(result.region, undefined);
    assert.equal(result.countryCode, undefined);
    assert.deepEqual(result.modes, []);
  });

  await t.test("Duplicate transport modes removed", () => {
    const result = mapTransitousPlace({
      ...station,
      modes: ["BUS", "TRAM", "BUS"],
    });

    assert.deepEqual(result.modes, ["BUS", "TRAM"]);
  });

  await t.test("Default locality preferred", () => {
    const result = mapTransitousPlace({
      ...station,
      areas: [
        { name: "Other district", adminLevel: 6 },
        {
          name: "Preferred locality",
          adminLevel: 4,
          default: true,
        },
      ],
    });

    assert.equal(result.locality, "Preferred locality");
    assert.equal(result.region, undefined);
  });

  await t.test("Locality fallback uses admin level 6", () => {
    const result = mapTransitousPlace({
      ...station,
      areas: [
        { name: "Braunschweig", adminLevel: 6 },
      ],
    });

    assert.equal(result.locality, "Braunschweig");
  });

  await t.test("Unknown API fields tolerated", () => {
    const raw = transitousPlaceSchema.parse({
      ...station,
      score: -34.15,
      importance: 0.01,
      futureField: true,
    });

    assert.equal(mapTransitousPlace(raw).id, station.id);
  });
});

test("Transitous search result mapping", async (t) => {
  const raw = [station, building, secondStop];

  function input(overrides = {}) {
    return searchPlacesInputSchema.parse({
      query: "Braunschweig Hauptbahnhof",
      ...overrides,
    });
  }

  await t.test("Provider ranking preserved", () => {
    const result = mapTransitousSearchResults(
      raw,
      input(),
    );

    assert.deepEqual(
      result.results.map(place => place.id),
      raw.map(place => place.id),
    );
  });

  await t.test("Stop filter applied", () => {
    const result = mapTransitousSearchResults(
      raw,
      input({ type: "stop" }),
    );

    assert.deepEqual(
      result.results.map(place => place.id),
      [station.id, secondStop.id],
    );
  });

  await t.test("Place filter applied", () => {
    const result = mapTransitousSearchResults(
      raw,
      input({ type: "place" }),
    );

    assert.equal(result.results.length, 1);
    assert.equal(result.results[0]?.id, building.id);
  });

  await t.test("Limit applied after filtering", () => {
    const result = mapTransitousSearchResults(
      [building, station, secondStop],
      input({ type: "stop", limit: 1 }),
    );

    assert.equal(result.results.length, 1);
    assert.equal(result.results[0]?.id, station.id);
  });

  await t.test("Duplicate IDs removed", () => {
    const result = mapTransitousSearchResults(
      [station, station, secondStop],
      input(),
    );

    assert.equal(result.results.length, 2);
  });

  await t.test("Same name with different IDs preserved", () => {
    const result = mapTransitousSearchResults(
      [station, building],
      input(),
    );

    assert.equal(result.results.length, 2);
  });

  await t.test("Empty results accepted", () => {
    const result = mapTransitousSearchResults(
      [],
      input(),
    );

    assert.deepEqual(result.results, []);
  });

  await t.test("No matching type returns empty results", () => {
    const result = mapTransitousSearchResults(
      raw,
      input({ type: "address" }),
    );

    assert.deepEqual(result.results, []);
  });

  await t.test("Provider attribution included", () => {
    const result = mapTransitousSearchResults(
      raw,
      input(),
    );

    assert.equal(result.provider, "transitous");
    assert.equal(
      result.attribution,
      "https://transitous.org/sources/",
    );
  });
});
