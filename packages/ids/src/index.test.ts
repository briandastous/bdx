import { expectTypeOf } from "expect-type";
import { describe, it } from "vitest";
import type { AssetMaterializationId } from "./index.js";
import {
  AssetInstanceId,
  PostId,
  SchedulerJobId,
  UserId,
  parseAssetMaterializationId,
  parseUserId,
} from "./index.js";

describe("ids brands", () => {
  it("distinguishes branded ids", () => {
    const userId = UserId(1n);
    const postId = PostId(2n);
    const instanceId = AssetInstanceId(3n);

    expectTypeOf(userId).toEqualTypeOf<UserId>();
    expectTypeOf(postId).toEqualTypeOf<PostId>();
    expectTypeOf(instanceId).toEqualTypeOf<AssetInstanceId>();

    expectTypeOf(userId).not.toEqualTypeOf<PostId>();
    expectTypeOf(postId).not.toEqualTypeOf<AssetInstanceId>();
  });

  it("keeps bigint assignability", () => {
    const userId = UserId(1n);
    expectTypeOf(userId).toExtend<bigint>();
  });

  it("brands parsed ids", () => {
    const userId = parseUserId("123");
    expectTypeOf(userId).toEqualTypeOf<UserId>();

    const materializationId = parseAssetMaterializationId("456");
    expectTypeOf(materializationId).toEqualTypeOf<AssetMaterializationId>();
  });

  it("brands string identifiers", () => {
    const jobId = SchedulerJobId("planner");
    expectTypeOf(jobId).toEqualTypeOf<SchedulerJobId>();
    expectTypeOf(jobId).toExtend<string>();
  });
});
