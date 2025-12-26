import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type StartedPostgreSqlContainer, PostgreSqlContainer } from "@testcontainers/postgresql";
import { createDb, destroyDb, migrateToLatest, type Db } from "@bdx/db";
import { createLogger } from "@bdx/observability";
import { TwitterApiClient, type XUserData } from "@bdx/twitterapi-io";
import { UserId } from "@bdx/ids";
import { buildServer } from "./server.js";

class StubTwitterApiClient extends TwitterApiClient {
  constructor(private readonly profiles: XUserData[]) {
    super({ token: "test-token", baseUrl: "http://localhost" });
  }

  override fetchUserProfileByHandle(handle: string): Promise<XUserData | null> {
    const profile = this.profiles.find((entry) => entry.userName === handle) ?? null;
    return Promise.resolve(profile);
  }

  override fetchUsersByIds(userIds: readonly UserId[]): Promise<Map<UserId, XUserData>> {
    const results = new Map<UserId, XUserData>();
    for (const profile of this.profiles) {
      if (profile.userId === null) continue;
      if (userIds.includes(profile.userId)) {
        results.set(profile.userId, profile);
      }
    }
    return Promise.resolve(results);
  }
}

function assertWebhookBody(
  value: unknown,
): asserts value is { follower_user_id: string; target_user_id: string } {
  if (!value || typeof value !== "object") {
    throw new Error("Unexpected webhook response body");
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record["follower_user_id"] !== "string" ||
    typeof record["target_user_id"] !== "string"
  ) {
    throw new Error("Unexpected webhook response body");
  }
}

function assertOpenapiDoc(value: unknown): asserts value is { paths: Record<string, unknown> } {
  if (!value || typeof value !== "object") {
    throw new Error("Unexpected OpenAPI response body");
  }
  const record = value as Record<string, unknown>;
  if (!record["paths"] || typeof record["paths"] !== "object") {
    throw new Error("Unexpected OpenAPI response body");
  }
}

describe("webhook ingestion", () => {
  let container: StartedPostgreSqlContainer;
  let db: Db;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:18")
      .withDatabase("bdx_test")
      .withUsername("bdx")
      .withPassword("bdx")
      .start();
    db = createDb(container.getConnectionUri());
    await migrateToLatest(db);
  });

  afterAll(async () => {
    await destroyDb(db);
    await container.stop();
  });

  function buildTestServer(profiles: XUserData[]) {
    return buildServer({
      db,
      logger: createLogger({ env: "test", level: "silent", service: "api" }),
      webhookToken: "secret",
      twitterClient: new StubTwitterApiClient(profiles),
      xSelf: { userId: UserId(555n), handle: "target" },
      usersByIdsBatchSize: 100,
    });
  }

  const targetProfile: XUserData = {
    userId: UserId(555n),
    userName: "target",
    displayName: "Target",
    profileUrl: null,
    profileImageUrl: null,
    coverImageUrl: null,
    bio: null,
    location: null,
    isBlueVerified: null,
    verifiedType: null,
    isTranslator: null,
    isAutomated: null,
    automatedBy: null,
    possiblySensitive: null,
    unavailable: null,
    unavailableMessage: null,
    unavailableReason: null,
    followersCount: null,
    followingCount: null,
    favouritesCount: null,
    mediaCount: null,
    statusesCount: null,
    createdAt: null,
    bioEntities: null,
    affiliatesHighlightedLabel: null,
    pinnedTweetIds: null,
    withheldCountries: null,
  };

  const followerProfile: XUserData = {
    userId: UserId(777n),
    userName: "follower",
    displayName: "Follower",
    profileUrl: null,
    profileImageUrl: null,
    coverImageUrl: null,
    bio: null,
    location: null,
    isBlueVerified: null,
    verifiedType: null,
    isTranslator: null,
    isAutomated: null,
    automatedBy: null,
    possiblySensitive: null,
    unavailable: null,
    unavailableMessage: null,
    unavailableReason: null,
    followersCount: null,
    followingCount: null,
    favouritesCount: null,
    mediaCount: null,
    statusesCount: null,
    createdAt: null,
    bioEntities: null,
    affiliatesHighlightedLabel: null,
    pinnedTweetIds: null,
    withheldCountries: null,
  };

  it("rejects missing webhook tokens", async () => {
    const server = buildTestServer([targetProfile, followerProfile]);
    await server.ready();

    const response = await server.inject({
      method: "POST",
      url: "/webhooks/ifttt/new-x-follower",
      payload: {
        LinkToProfile: "https://x.com/follower",
      },
    });

    expect(response.statusCode).toBe(401);
    await server.close();
  });

  it("rejects invalid webhook payloads", async () => {
    const server = buildTestServer([targetProfile, followerProfile]);
    await server.ready();

    const response = await server.inject({
      method: "POST",
      url: "/webhooks/ifttt/new-x-follower?token=secret",
      payload: {
        Missing: "LinkToProfile",
      },
    });

    expect(response.statusCode).toBe(400);
    await server.close();
  });

  it("accepts a webhook and persists the follower relationship", async () => {
    const server = buildTestServer([targetProfile, followerProfile]);
    await server.ready();

    const response = await server.inject({
      method: "POST",
      url: "/webhooks/ifttt/new-x-follower?token=secret",
      payload: {
        LinkToProfile: "https://x.com/follower",
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<unknown>();
    assertWebhookBody(body);
    expect(body.follower_user_id).toBe("777");
    expect(body.target_user_id).toBe("555");

    const webhookRows = await db.selectFrom("webhook_follow_events").selectAll().execute();
    expect(webhookRows).toHaveLength(1);

    const followRows = await db
      .selectFrom("follows")
      .select(["target_id", "follower_id", "is_deleted"])
      .execute();
    expect(followRows).toEqual([
      { target_id: UserId(555n), follower_id: UserId(777n), is_deleted: false },
    ]);

    const users = await db.selectFrom("users").select(["id"]).orderBy("id", "asc").execute();
    expect(users.map((row) => row.id)).toEqual([UserId(555n), UserId(777n)]);

    await server.close();
  });

  it("serves OpenAPI JSON", async () => {
    const server = buildTestServer([targetProfile, followerProfile]);
    await server.ready();

    const response = await server.inject({ method: "GET", url: "/openapi.json" });
    expect(response.statusCode).toBe(200);
    const body = response.json<unknown>();
    assertOpenapiDoc(body);
    expect(body.paths).toHaveProperty("/webhooks/ifttt/new-x-follower");

    await server.close();
  });
});
