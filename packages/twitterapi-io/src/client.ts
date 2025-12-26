import type {
  FollowersItem,
  FollowingsItem,
  TweetItem,
  TweetsByIdsItem,
  UserBatchItem,
  UserInfoData,
} from "./api_types.js";
import { convertTweet, convertUser } from "./conversions.js";
import {
  TwitterApiRateLimitError,
  TwitterApiRequestError,
  TwitterApiTransportError,
  TwitterApiUnexpectedResponseError,
} from "./errors.js";
import type { PostId, UserId } from "@bdx/ids";
import { chooseCursor, chooseHasNext } from "./pagination.js";
import { configureRateLimit, enforceRateLimit } from "./rate_limit.js";
import type {
  FollowersPage,
  FollowingsPage,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  PostsPage,
  RequestSnapshot,
  ResponseSnapshot,
  TweetData,
  XUserData,
} from "./types.js";

export interface TwitterApiClientOptions {
  token: string;
  baseUrl?: string;
  minIntervalMs?: number | null;
  fetch?: typeof fetch;
}

export class TwitterApiClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private lastRequest: RequestSnapshot | null = null;
  private lastResponse: ResponseSnapshot | null = null;

  constructor(options: TwitterApiClientOptions) {
    this.token = options.token;
    this.baseUrl = options.baseUrl ?? "https://api.twitterapi.io";
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    configureRateLimit(options.minIntervalMs ?? null);
  }

  lastExchange(): { request: RequestSnapshot | null; response: ResponseSnapshot | null } {
    return { request: this.lastRequest, response: this.lastResponse };
  }

  async fetchUserProfileByHandle(handle: string): Promise<XUserData | null> {
    const { json } = await this.requestJson("/twitter/user/info", { userName: handle });
    const payload = ensureJsonObject(json, "user info response");
    const data = payload["data"];
    if (!isUserInfoData(data)) {
      const params: { status?: number; request?: RequestSnapshot; response?: ResponseSnapshot } =
        {};
      params.status = 200;
      if (this.lastRequest) params.request = this.lastRequest;
      if (this.lastResponse) params.response = this.lastResponse;
      throw new TwitterApiUnexpectedResponseError("User info response missing data", params);
    }
    return convertUser(data);
  }

  async fetchUserProfileById(userId: UserId): Promise<XUserData | null> {
    const users = await this.fetchUsersByIds([userId]);
    return users.get(userId) ?? null;
  }

  async fetchUsersByIds(userIds: readonly UserId[]): Promise<Map<UserId, XUserData>> {
    if (userIds.length === 0) return new Map<UserId, XUserData>();
    const unique = Array.from(new Set(userIds));
    const { json } = await this.requestJson("/twitter/user/batch_info_by_ids", {
      userIds: unique.map((id) => id.toString()).join(","),
    });
    const payload = ensureJsonObject(json, "user batch response");
    const users = asJsonArray(payload["users"]).filter(isUserBatchItem).map(convertUser);
    const byId = new Map<UserId, XUserData>();
    for (const user of users) {
      if (user.userId !== null) {
        byId.set(user.userId, user);
      }
    }
    return byId;
  }

  async fetchFollowersPage(handle: string, cursor?: string | null): Promise<FollowersPage> {
    const { json, request, response } = await this.requestJson("/twitter/user/followers", {
      userName: handle,
      cursor: cursor ?? undefined,
      pageSize: 200,
    });
    const raw = ensureJsonObject(json, "followers response");
    const followers = asJsonArray(raw["followers"]).filter(isFollowersItem);
    const converted = followers.map(convertUser);
    const nextCursor = chooseCursor([raw]);
    const hasNextPage = chooseHasNext([raw], undefined, nextCursor);

    return {
      followers: converted,
      nextCursor,
      hasNextPage,
      rawResponse: raw,
      request,
      response,
    };
  }

  async fetchFollowingsPage(handle: string, cursor?: string | null): Promise<FollowingsPage> {
    const { json, request, response } = await this.requestJson("/twitter/user/followings", {
      userName: handle,
      cursor: cursor ?? undefined,
      pageSize: 200,
    });
    const raw = ensureJsonObject(json, "followings response");
    const followings = asJsonArray(raw["followings"]).filter(isFollowingsItem);
    const converted = followings.map(convertUser);
    const nextCursor = chooseCursor([raw]);
    const hasNextPage = chooseHasNext([raw], undefined, nextCursor);

    return {
      followings: converted,
      nextCursor,
      hasNextPage,
      rawResponse: raw,
      request,
      response,
    };
  }

  async fetchPostsPage(query: string, cursor?: string | null): Promise<PostsPage> {
    const { json, request, response } = await this.requestJson("/twitter/tweet/advanced_search", {
      query,
      queryType: "Latest",
      cursor: cursor ?? undefined,
    });

    const raw = ensureJsonObject(json, "posts response");
    const tweets = asJsonArray(raw["tweets"]).filter(isTweetItem);
    const posts = tweets
      .map(convertTweet)
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    const nextCursor = chooseCursor([raw]);
    const hasNextPage = chooseHasNext([raw], undefined, nextCursor);

    return {
      posts,
      nextCursor,
      hasNextPage,
      rawResponse: raw,
      request,
      response,
    };
  }

  async fetchTweetsByIds(tweetIds: readonly PostId[]): Promise<TweetData[]> {
    if (tweetIds.length === 0) return [];
    const unique = Array.from(new Set(tweetIds));
    const { json } = await this.requestJson("/twitter/tweets", {
      tweet_ids: unique.map((id) => id.toString()).join(","),
    });
    const payload = ensureJsonObject(json, "tweets by ids response");
    const tweets = asJsonArray(payload["tweets"]).filter(isTweetsByIdsItem);
    return tweets
      .map(convertTweet)
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
  }

  private async requestJson(
    path: string,
    query: Record<string, string | number | boolean | undefined>,
  ): Promise<{ json: JsonValue; request: RequestSnapshot; response: ResponseSnapshot }> {
    await enforceRateLimit();

    const url = new URL(path, this.baseUrl);
    const params: Record<string, JsonPrimitive> = {};

    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      url.searchParams.set(key, String(value));
      params[key] = value;
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: `Bearer ${this.token}`,
      "x-api-key": this.token,
    };

    const requestSnapshot: RequestSnapshot = {
      method: "GET",
      url: url.toString(),
      params,
      headers: maskHeaders(headers),
    };

    this.lastRequest = requestSnapshot;
    this.lastResponse = null;

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "GET",
        headers,
      });
    } catch (error) {
      throw new TwitterApiTransportError("twitterapi.io request failed", error, {
        request: requestSnapshot,
      });
    }

    const bodyText = await response.text();
    const responseSnapshot: ResponseSnapshot = {
      statusCode: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: bodyText,
    };

    this.lastResponse = responseSnapshot;

    let parsed: JsonValue = null;
    if (bodyText.trim().length > 0) {
      try {
        parsed = JSON.parse(bodyText) as JsonValue;
      } catch {
        throw new TwitterApiUnexpectedResponseError("twitterapi.io returned invalid JSON", {
          status: response.status,
          request: requestSnapshot,
          response: responseSnapshot,
        });
      }
    }

    if (response.status === 429) {
      const message = extractMessage(parsed) ?? "Rate limited by twitterapi.io";
      throw new TwitterApiRateLimitError(message, {
        status: response.status,
        retryAfterSeconds: parseRetryAfterSeconds(response),
        request: requestSnapshot,
        response: responseSnapshot,
      });
    }

    if (response.status >= 500) {
      throw new TwitterApiUnexpectedResponseError(`twitterapi.io returned ${response.status}`, {
        status: response.status,
        request: requestSnapshot,
        response: responseSnapshot,
      });
    }

    if (response.status >= 400) {
      const message = extractMessage(parsed) ?? `twitterapi.io returned ${response.status}`;
      throw new TwitterApiRequestError(message, {
        status: response.status,
        request: requestSnapshot,
        response: responseSnapshot,
      });
    }

    return { json: parsed, request: requestSnapshot, response: responseSnapshot };
  }
}

function maskHeaders(headers: Record<string, string>): Record<string, string> {
  const masked: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (lower === "authorization" || lower === "x-api-key") {
      masked[key] = "<redacted>";
      continue;
    }
    masked[key] = value;
  }
  return masked;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  return isJsonObject(value);
}

function ensureJsonObject(value: unknown, label: string): JsonObject {
  if (isJsonObject(value)) return value;
  throw new TwitterApiUnexpectedResponseError(`twitterapi.io returned non-object ${label}`);
}

function extractMessage(value: JsonValue): string | null {
  if (!isJsonObject(value)) return null;
  const message = value["message"];
  return typeof message === "string" ? message : null;
}

function asJsonArray(value: unknown): JsonValue[] {
  return Array.isArray(value) ? value.filter(isJsonValue) : [];
}

function isUserInfoData(value: unknown): value is UserInfoData {
  return isJsonObject(value);
}

function isUserBatchItem(value: unknown): value is UserBatchItem {
  return isJsonObject(value);
}

function isFollowersItem(value: unknown): value is FollowersItem {
  return isJsonObject(value);
}

function isFollowingsItem(value: unknown): value is FollowingsItem {
  return isJsonObject(value);
}

function isTweetItem(value: unknown): value is TweetItem {
  return isJsonObject(value);
}

function isTweetsByIdsItem(value: unknown): value is TweetsByIdsItem {
  return isJsonObject(value);
}

function parseRetryAfterSeconds(response: Response): number | null {
  const header = response.headers.get("retry-after") ?? response.headers.get("Retry-After");
  if (!header) return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) ? seconds : null;
}
