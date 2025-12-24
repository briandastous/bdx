import { describe, expect, it } from "vitest";
import { convertTweet, convertUser } from "./conversions.js";
import type { TweetItem, UserInfoData } from "./api_types.js";

describe("twitterapi-io conversions", () => {
  it("rejects unsafe numeric tweet ids", () => {
    const tweet = {
      id: 9007199254740992,
      createdAt: "2024-01-01T00:00:00.000Z",
      author: { id: "1" },
    } as unknown as TweetItem;

    expect(convertTweet(tweet)).toBeNull();
  });

  it("rejects unsafe numeric user ids", () => {
    const user = { id: 9007199254740992 } as unknown as UserInfoData;

    expect(convertUser(user).userId).toBeNull();
  });
});
