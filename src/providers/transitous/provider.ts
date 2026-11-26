import { performance } from "node:perf_hooks";

import { TtlLruCache } from "../../cache/ttl-lru.ts";
import { ProviderError } from "../errors.ts";

import {
  searchPlacesInputSchema,
} from "../types.ts";

import type {
  MobilityProvider,
  SearchPlacesInput,
  SearchPlacesResult,
} from "../types.ts";

import type {
  TransitousClient,
} from "./client.ts";

import type {
  TransitousPlace,
} from "./schemas.ts";

import {
  mapTransitousSearchResults,
} from "./mapper.ts";

type GeocodeClient = Pick<TransitousClient, "geocode">;

export class TransitousProvider implements MobilityProvider {
  readonly name = "transitous";

  readonly #client: GeocodeClient;

  readonly #cache: TtlLruCache<
    string,
    TransitousPlace[]
  >;

  readonly #inFlight = new Map<
    string,
    Promise<TransitousPlace[]>
  >();

  readonly #now: () => number;

  readonly #maxConcurrent = 2;
  readonly #minIntervalMs = 1000;

  #lastRequestAt = -Infinity;

  constructor(
    client: GeocodeClient,
    now: () => number = () => performance.now(),
  ) {
    this.#client = client;
    this.#now = now;

    this.#cache = new TtlLruCache({
      maxEntries: 128,
      ttlMs: 15 * 60 * 1000,
      maxBytes: 4 * 1024 * 1024,

      sizeOf: value =>
        Buffer.byteLength(JSON.stringify(value), "utf8"),

      now,
    });
  }

  async #loadPlaces(
    query: string,
  ): Promise<TransitousPlace[]> {
    const cached = this.#cache.get(query);

    if (cached !== undefined) {
      return cached;
    }

    const existing = this.#inFlight.get(query);

    if (existing !== undefined) {
      return existing;
    }

    if (this.#inFlight.size >= this.#maxConcurrent) {
      throw new ProviderError(
        "BUSY",
        "Too many concurrent mobility requests",
        true,
      );
    }

    const now = this.#now();

    if (now - this.#lastRequestAt < this.#minIntervalMs) {
      throw new ProviderError(
        "RATE_LIMITED",
        "Mobility request interval not yet elapsed",
        true,
      );
    }

    this.#lastRequestAt = now;

    const pending = Promise.resolve()
      .then(() => this.#client.geocode(query))
      .then(result => {
        this.#cache.set(query, result);
        return result;
      })
      .finally(() => {
        this.#inFlight.delete(query);
      });

    this.#inFlight.set(query, pending);

    return pending;
  }

  async searchPlaces(
    input: SearchPlacesInput,
  ): Promise<SearchPlacesResult> {
    const validated = searchPlacesInputSchema.parse(input);

    const query = validated.query
      .normalize("NFC")
      .replace(/\s+/g, " ");

    const raw = await this.#loadPlaces(query);

    return mapTransitousSearchResults(
      raw,
      validated,
    );
  }
}
