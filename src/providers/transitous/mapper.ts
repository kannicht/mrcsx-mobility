import {
  mobilityPlaceSchema,
  searchPlacesResultSchema,
} from "../types.ts";

import type {
  MobilityPlace,
  PlaceType,
  SearchPlacesInput,
  SearchPlacesResult,
} from "../types.ts";

import type {
  TransitousPlace,
} from "./schemas.ts";

const placeTypes = {
  STOP: "stop",
  ADDRESS: "address",
  PLACE: "place",
} as const satisfies Record<
  TransitousPlace["type"],
  PlaceType
>;

export function mapTransitousPlace(
  raw: TransitousPlace,
): MobilityPlace {
  const locality =
    raw.areas.find(area => area.default === true)?.name
    ?? raw.areas.find(area => area.adminLevel === 6)?.name;

  const region = raw.areas.find(
    area => area.adminLevel === 4,
  )?.name;

  return mobilityPlaceSchema.parse({
    id: raw.id.trim().length > 0 ? raw.id : null,
    name: raw.name,
    type: placeTypes[raw.type],

    latitude: raw.lat,
    longitude: raw.lon,

    countryCode: raw.country,
    postalCode: raw.zip,
    street: raw.street,
    houseNumber: raw.houseNumber,
    timezone: raw.tz,

    locality,
    region: region !== locality ? region : undefined,

    modes: [...new Set(raw.modes)],
  });
}

export function mapTransitousSearchResults(
  raw: readonly TransitousPlace[],
  input: SearchPlacesInput,
): SearchPlacesResult {
  const results: MobilityPlace[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    const place = mapTransitousPlace(entry);

    if (
      input.type !== "all" &&
      place.type !== input.type
    ) {
      continue;
    }

    const key = place.id !== null
      ? JSON.stringify([place.type, place.id])
      : JSON.stringify([
          place.type,
          place.name,
          place.latitude,
          place.longitude,
        ]);

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    results.push(place);

    if (results.length >= input.limit) {
      break;
    }
  }

  return searchPlacesResultSchema.parse({
    provider: "transitous",
    query: input.query,
    results,
    attribution: "https://transitous.org/sources/",
  });
}
