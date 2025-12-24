import { expectTypeOf } from "expect-type";
import { describe, expect, it } from "vitest";
import type { UserId } from "@bdx/ids";
import { UserId as UserIdBrand } from "@bdx/ids";
import { formatAssetParams, paramsHashV1, parseAssetParams } from "./params.js";

describe("parseAssetParams", () => {
  it("normalizes specified users params", () => {
    const params = parseAssetParams("segment_specified_users", { stableKey: "alpha" });
    expect(params).toEqual({
      assetSlug: "segment_specified_users",
      stableKey: "alpha",
      fanoutSourceParamsHash: null,
    });
  });

  it("parses subject segments with bigint ids", () => {
    const params = parseAssetParams("segment_followers", { subjectExternalId: "42" });
    expect(params.assetSlug).toBe("segment_followers");
    if (params.assetSlug !== "segment_followers") {
      throw new Error("Expected segment_followers params");
    }
    expectTypeOf(params.subjectExternalId).toEqualTypeOf<UserId>();
    expect(params.subjectExternalId).toBe(UserIdBrand(42n));
    expect(params.fanoutSourceParamsHash).toBeNull();
  });

  it("rejects unsafe integer user ids", () => {
    expect(() =>
      parseAssetParams("segment_followers", { subjectExternalId: 9007199254740992 }),
    ).toThrow(/safe integer/i);
  });

  it("parses post corpus params with nested segments", () => {
    const params = parseAssetParams("post_corpus_for_segment", {
      sourceSegment: {
        assetSlug: "segment_followed",
        subjectExternalId: 99,
      },
    });
    expect(params.assetSlug).toBe("post_corpus_for_segment");
    if (params.assetSlug !== "post_corpus_for_segment") {
      throw new Error("Expected post_corpus_for_segment params");
    }
    const sourceSegment = params.sourceSegmentParams;
    expect(sourceSegment.assetSlug).toBe("segment_followed");
    if (sourceSegment.assetSlug !== "segment_followed") {
      throw new Error("Expected segment_followed source segment");
    }
    expectTypeOf(sourceSegment.subjectExternalId).toEqualTypeOf<UserId>();
    expect(sourceSegment.subjectExternalId).toBe(UserIdBrand(99n));
    expect(params.fanoutSourceParamsHash).toBeNull();
  });
});

describe("paramsHashV1", () => {
  it("is stable for identical params and sensitive to fanout", () => {
    const base = {
      assetSlug: "segment_followers",
      subjectExternalId: UserIdBrand(123n),
      fanoutSourceParamsHash: null,
    } as const;
    const same = {
      assetSlug: "segment_followers",
      subjectExternalId: UserIdBrand(123n),
      fanoutSourceParamsHash: null,
    } as const;
    const withFanout = {
      assetSlug: "segment_followers",
      subjectExternalId: UserIdBrand(123n),
      fanoutSourceParamsHash: "hash-1",
    } as const;

    expect(paramsHashV1(base)).toBe(paramsHashV1(same));
    expect(paramsHashV1(base)).not.toBe(paramsHashV1(withFanout));
  });

  it("changes when nested segment params change", () => {
    const segment = {
      assetSlug: "segment_specified_users",
      stableKey: "alpha",
      fanoutSourceParamsHash: null,
    } as const;
    const postCorpus = {
      assetSlug: "post_corpus_for_segment",
      sourceSegmentParams: segment,
      fanoutSourceParamsHash: null,
    } as const;
    const postCorpusAlt = {
      assetSlug: "post_corpus_for_segment",
      sourceSegmentParams: { ...segment, stableKey: "beta" },
      fanoutSourceParamsHash: null,
    } as const;

    expect(paramsHashV1(postCorpus)).not.toBe(paramsHashV1(postCorpusAlt));
  });
});

describe("formatAssetParams", () => {
  it("renders a stable label for logs", () => {
    const params = parseAssetParams("segment_specified_users", { stableKey: "alpha" });
    expect(formatAssetParams(params)).toContain("stableKey=alpha");
  });
});
