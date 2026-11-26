import assert from "node:assert/strict";
import { test } from "node:test";

import {
  TtlLruCache,
} from "../../src/cache/ttl-lru.ts";

function fixture() {
  let now = 0;

  const cache = new TtlLruCache<string, string>({
    maxEntries: 3,
    ttlMs: 1000,
    maxBytes: 10,
    sizeOf: value => Buffer.byteLength(value),
    now: () => now,
  });

  return {
    cache,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

test("TTL LRU cache", async (t) => {
  await t.test("Cache miss returns undefined", () => {
    const { cache } = fixture();

    assert.equal(cache.get("missing"), undefined);
  });

  await t.test("Stored value returned", () => {
    const { cache } = fixture();

    cache.set("a", "123");

    assert.equal(cache.get("a"), "123");
    assert.equal(cache.size, 1);
    assert.equal(cache.bytes, 3);
  });

  await t.test("Expired entry removed", () => {
    const { cache, advance } = fixture();

    cache.set("a", "123");

    advance(1000);

    assert.equal(cache.get("a"), undefined);
    assert.equal(cache.size, 0);
    assert.equal(cache.bytes, 0);
  });

  await t.test("Reading does not extend TTL", () => {
    const { cache, advance } = fixture();

    cache.set("a", "123");

    advance(900);
    assert.equal(cache.get("a"), "123");

    advance(100);
    assert.equal(cache.get("a"), undefined);
  });

  await t.test("Least recently used entry evicted", () => {
    const { cache } = fixture();

    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("c", "3");

    cache.get("a");
    cache.set("d", "4");

    assert.equal(cache.get("a"), "1");
    assert.equal(cache.get("b"), undefined);
    assert.equal(cache.size, 3);
  });

  await t.test("Byte limit enforced", () => {
    const { cache } = fixture();

    cache.set("a", "123456");
    cache.set("b", "789012");

    assert.equal(cache.get("a"), undefined);
    assert.equal(cache.get("b"), "789012");
    assert.equal(cache.bytes, 6);
  });

  await t.test("Oversized entry not cached", () => {
    const { cache } = fixture();

    cache.set("a", "12345678901");

    assert.equal(cache.get("a"), undefined);
    assert.equal(cache.bytes, 0);
  });

  await t.test("Replacing entry updates size", () => {
    const { cache } = fixture();

    cache.set("a", "123456");
    cache.set("a", "12");

    assert.equal(cache.bytes, 2);
    assert.equal(cache.size, 1);
  });

  await t.test("Expired entries purged on insertion", () => {
    const { cache, advance } = fixture();

    cache.set("a", "123");

    advance(1000);
    cache.set("b", "45");

    assert.equal(cache.size, 1);
    assert.equal(cache.bytes, 2);
  });

  await t.test("Clear resets cache", () => {
    const { cache } = fixture();

    cache.set("a", "123");
    cache.clear();

    assert.equal(cache.size, 0);
    assert.equal(cache.bytes, 0);
  });
});
