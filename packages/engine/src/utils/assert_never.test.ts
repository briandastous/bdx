import { expectTypeOf } from "expect-type";
import { describe, it } from "vitest";
import { assertNever } from "./assert_never.js";

describe("assertNever (types)", () => {
  it("accepts only never", () => {
    type Param = Parameters<typeof assertNever>[0];

    const neverValue = undefined as never;
    const optionalMessage = undefined as string | undefined;
    expectTypeOf(assertNever).parameter(0).toEqualTypeOf(neverValue);
    expectTypeOf(assertNever).parameter(1).toEqualTypeOf(optionalMessage);
    expectTypeOf(assertNever).returns.toEqualTypeOf(neverValue);

    // @ts-expect-error assertNever only accepts never
    const _invalid: Param = "not-never";
    void _invalid;
  });
});
