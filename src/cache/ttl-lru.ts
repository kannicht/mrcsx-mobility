import { performance } from "node:perf_hooks";

type CacheEntry<V> = {
  value: V;
  expiresAt: number;
  size: number;
};

export class TtlLruCache<K, V> {
  readonly #entries = new Map<K, CacheEntry<V>>();

  readonly #maxEntries: number;
  readonly #ttlMs: number;
  readonly #maxBytes: number;
  readonly #sizeOf: (value: V) => number;
  readonly #now: () => number;

  #bytes = 0;

  constructor(options: {
    maxEntries: number;
    ttlMs: number;
    maxBytes: number;
    sizeOf: (value: V) => number;
    now?: () => number;
  }) {
    for (const value of [
      options.maxEntries,
      options.ttlMs,
      options.maxBytes,
    ]) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new Error("Invalid cache configuration");
      }
    }

    this.#maxEntries = options.maxEntries;
    this.#ttlMs = options.ttlMs;
    this.#maxBytes = options.maxBytes;
    this.#sizeOf = options.sizeOf;
    this.#now = options.now ?? (() => performance.now());
  }

  get size(): number {
    this.#purgeExpired();
    return this.#entries.size;
  }

  get bytes(): number {
    this.#purgeExpired();
    return this.#bytes;
  }

  #delete(key: K): void {
    const entry = this.#entries.get(key);

    if (entry !== undefined) {
      this.#bytes -= entry.size;
      this.#entries.delete(key);
    }
  }

  #purgeExpired(): void {
    const now = this.#now();

    for (const [key, entry] of this.#entries) {
      if (entry.expiresAt <= now) {
        this.#delete(key);
      }
    }
  }

  get(key: K): V | undefined {
    const entry = this.#entries.get(key);

    if (entry === undefined) {
      return undefined;
    }

    if (entry.expiresAt <= this.#now()) {
      this.#delete(key);
      return undefined;
    }

    // Mark entry as recently used.
    this.#entries.delete(key);
    this.#entries.set(key, entry);

    return entry.value;
  }

  set(key: K, value: V): void {
    const size = this.#sizeOf(value);

    if (!Number.isSafeInteger(size) || size < 0) {
      throw new Error("Invalid cache entry size");
    }

    this.#purgeExpired();
    this.#delete(key);

    if (size > this.#maxBytes) {
      return;
    }

    this.#entries.set(key, {
      value,
      size,
      expiresAt: this.#now() + this.#ttlMs,
    });

    this.#bytes += size;

    while (
      this.#entries.size > this.#maxEntries ||
      this.#bytes > this.#maxBytes
    ) {
      const oldest = this.#entries.keys().next();

      if (oldest.done) {
        break;
      }

      this.#delete(oldest.value);
    }
  }

  clear(): void {
    this.#entries.clear();
    this.#bytes = 0;
  }
}
