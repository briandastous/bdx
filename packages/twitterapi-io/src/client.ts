import type {
  FollowersItem,
  FollowersResponse,
  FollowingsItem,
  FollowingsResponse,
  PostsResponse,
  TweetItem,
  UserBatchItem,
  UserBatchResponse,
  UserInfoResponse,
} from "./api_types.js";
import { convertTweet, convertUser } from "./conversions.js";
import {
  TwitterApiRateLimitError,
  TwitterApiRequestError,
  TwitterApiTransportError,
  TwitterApiUnexpectedResponseError,
} from "./errors.js";
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
    const payload = json as UserInfoResponse;
    const data = payload?.data ?? null;
    if (!data) {
      const params: { status?: number; request?: RequestSnapshot; response?: ResponseSnapshot } = {};
      if (payload) params.status = 200;
      if (this.lastRequest) params.request = this.lastRequest;
      if (this.lastResponse) params.response = this.lastResponse;
      throw new TwitterApiUnexpectedResponseError("User info response missing data", params);
    }
    return convertUser(data);
  }

  async fetchUserProfileById(userId: bigint): Promise<XUserData | null> {
    const { json } = await this.requestJson("/twitter/user/batch_info_by_ids", {
      userIds: userId.toString(),
    });
    const payload = json as UserBatchResponse;
    const users = (payload?.users ?? []) as UserBatchItem[];
    if (users.length === 0) return null;

    const match = users.find((user) => user.id === userId.toString());
    const fallback = users[0];
    if (!fallback) return null;
    return convertUser(match ?? fallback);
  }

  async fetchFollowersPage(handle: string, cursor?: string | null): Promise<FollowersPage> {
    const { json, request, response } = await this.requestJson("/twitter/user/followers", {
      userName: handle,
      cursor: cursor ?? undefined,
      pageSize: 200,
    });
    const payload = json as FollowersResponse;
    const raw = ensureJsonObject(json, "followers response");
    const followers = (payload?.followers ?? []) as FollowersItem[];
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
    const payload = json as FollowingsResponse;
    const raw = ensureJsonObject(json, "followings response");
    const followings = (payload?.followings ?? []) as FollowingsItem[];
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

    const payload = json as PostsResponse;
    const raw = ensureJsonObject(json, "posts response");
    const tweets = (payload?.tweets ?? []) as TweetItem[];
    const posts = tweets.map(convertTweet).filter((item): item is NonNullable<typeof item> => Boolean(item));
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
      throw new TwitterApiUnexpectedResponseError(
        `twitterapi.io returned ${response.status}`,
        {
          status: response.status,
          request: requestSnapshot,
          response: responseSnapshot,
        },
      );
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

function ensureJsonObject(value: JsonValue, label: string): JsonObject {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as JsonObject;
  }
  throw new TwitterApiUnexpectedResponseError(`twitterapi.io returned non-object ${label}`);
}

function extractMessage(value: JsonValue): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const message = (value as JsonObject)["message"];
  return typeof message === "string" ? message : null;
}

function parseRetryAfterSeconds(response: Response): number | null {
  const header = response.headers.get("retry-after") ?? response.headers.get("Retry-After");
  if (!header) return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) ? seconds : null;
}
