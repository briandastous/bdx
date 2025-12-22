import { describe, expect, it } from "vitest";
import { hashJsonV1, sha256Hex, stableJsonStringify } from "./hashing.js";

describe("sha256Hex", () => {
  it("hashes known values", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("stableJsonStringify", () => {
  it("sorts object keys deterministically", () => {
    expect(stableJsonStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("omits undefined object fields", () => {
    expect(stableJsonStringify({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("rejects bigint inputs", () => {
    expect(() => stableJsonStringify({ id: 1n })).toThrow(/bigint not allowed/);
  });
});

describe("hashJsonV1", () => {
  it("is deterministic across key order", () => {
    const left = hashJsonV1({ a: 1, b: 2 });
    const right = hashJsonV1({ b: 2, a: 1 });

    expect(left.version).toBe(1);
    expect(left.hash).toBe(right.hash);
  });
});

