import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PostId, UserId } from "@bdx/ids";
import { TwitterApiClient } from "./client.js";
import {
  TwitterApiRateLimitError,
  TwitterApiRequestError,
  TwitterApiUnexpectedResponseError,
} from "./errors.js";

function loadFixture(path: string): unknown {
  const raw = readFileSync(new URL(path, import.meta.url), "utf8");
  return JSON.parse(raw);
}

function createFetch(responseFactory: () => Response): typeof fetch {
  return () => Promise.resolve(responseFactory());
}

function createClient(responseFactory: () => Response): TwitterApiClient {
  return new TwitterApiClient({
    token: "test-token",
    baseUrl: "https://example.test",
    minIntervalMs: 0,
    fetch: createFetch(responseFactory),
  });
}

describe("TwitterApiClient", () => {
  it("maps 429 to a rate limit error", async () => {
    const client = createClient(
      () =>
        new Response(JSON.stringify({ message: "too many" }), {
          status: 429,
          headers: { "Retry-After": "3" },
        }),
    );

    let caught: unknown;
    try {
      await client.fetchFollowersPage("example");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(TwitterApiRateLimitError);
    if (caught instanceof TwitterApiRateLimitError) {
      expect(caught.retryAfterSeconds).toBe(3);
      expect(caught.status).toBe(429);
    }
  });

  it("maps 4xx responses to request errors", async () => {
    const client = createClient(
      () => new Response(JSON.stringify({ message: "bad request" }), { status: 400 }),
    );

    await expect(client.fetchFollowersPage("example")).rejects.toBeInstanceOf(
      TwitterApiRequestError,
    );
  });

  it("maps 5xx responses to unexpected response errors", async () => {
    const client = createClient(() => new Response("{}", { status: 503 }));

    await expect(client.fetchFollowersPage("example")).rejects.toBeInstanceOf(
      TwitterApiUnexpectedResponseError,
    );
  });

  it("rejects invalid JSON bodies", async () => {
    const client = createClient(() => new Response("not json", { status: 200 }));

    await expect(client.fetchFollowersPage("example")).rejects.toBeInstanceOf(
      TwitterApiUnexpectedResponseError,
    );
  });

  it("falls back to raw cursor fields when typed fields are missing", async () => {
    const client = createClient(
      () =>
        new Response(JSON.stringify({ followers: [], cursor: "next" }), {
          status: 200,
        }),
    );

    const page = await client.fetchFollowersPage("example");
    expect(page.nextCursor).toBe("next");
    expect(page.hasNextPage).toBe(true);
  });

  it("parses follower fixtures into typed pages", async () => {
    const payload = loadFixture("./__fixtures__/followers_page.json");
    const client = createClient(() => new Response(JSON.stringify(payload), { status: 200 }));

    const page = await client.fetchFollowersPage("example");
    expect(page.followers[0]?.userId).toBe(UserId(101n));
    expect(page.followers[0]?.userName).toBe("alice");
    expect(page.nextCursor).toBe("next");
    expect(page.hasNextPage).toBe(true);
  });

  it("parses followings fixtures into typed pages", async () => {
    const payload = loadFixture("./__fixtures__/followings_page.json");
    const client = createClient(() => new Response(JSON.stringify(payload), { status: 200 }));

    const page = await client.fetchFollowingsPage("example");
    expect(page.followings[0]?.userId).toBe(UserId(202n));
    expect(page.followings[0]?.userName).toBe("bob");
    expect(page.nextCursor).toBeNull();
    expect(page.hasNextPage).toBe(false);
  });

  it("parses user batch fixtures", async () => {
    const payload = loadFixture("./__fixtures__/user_batch.json");
    const client = createClient(() => new Response(JSON.stringify(payload), { status: 200 }));

    const user = await client.fetchUserProfileById(UserId(101n));
    expect(user?.userId).toBe(UserId(101n));
    expect(user?.userName).toBe("alice");
  });

  it("fetches batch users by ids", async () => {
    const payload = loadFixture("./__fixtures__/user_batch.json");
    const client = createClient(() => new Response(JSON.stringify(payload), { status: 200 }));

    const users = await client.fetchUsersByIds([UserId(101n)]);
    expect(users.get(UserId(101n))?.userName).toBe("alice");
  });

  it("parses posts fixtures into typed pages", async () => {
    const payload = loadFixture("./__fixtures__/posts_page.json");
    const client = createClient(() => new Response(JSON.stringify(payload), { status: 200 }));

    const page = await client.fetchPostsPage("from:alice");
    expect(page.posts[0]?.postId).toBe(PostId(500n));
    expect(page.posts[0]?.authorUserId).toBe(UserId(101n));
  });

  it("fetches tweets by ids", async () => {
    const payload = loadFixture("./__fixtures__/tweets_by_ids.json");
    const client = createClient(() => new Response(JSON.stringify(payload), { status: 200 }));

    const tweets = await client.fetchTweetsByIds([PostId(900n)]);
    expect(tweets[0]?.postId).toBe(PostId(900n));
    expect(tweets[0]?.authorUserId).toBe(UserId(777n));
    expect(tweets[0]?.authorProfile?.userName).toBe("hydrated_author");
  });
});
