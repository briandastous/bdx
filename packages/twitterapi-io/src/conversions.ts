import type {
  FollowersItem,
  FollowingsItem,
  TweetItem,
  UserBatchItem,
  UserInfoData,
} from "./api_types.js";
import type { JsonObject, JsonValue, TweetData, XUserData } from "./types.js";

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asJsonObject(value: unknown): JsonObject | null {
  return isRecord(value) ? value : null;
}

function toString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function toBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function toBigInt(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value)) return null;
    return BigInt(value);
  }
  if (typeof value === "string") {
    if (value.trim().length === 0) return null;
    try {
      return BigInt(value);
    } catch {
      return null;
    }
  }
  return null;
}

function toStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const filtered = value.filter((item) => typeof item === "string") as string[];
  return filtered.length > 0 ? filtered : [];
}

function parseDate(value: unknown): Date | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export function convertUser(
  item: UserInfoData | UserBatchItem | FollowersItem | FollowingsItem,
): XUserData {
  const profileBio = asJsonObject("profile_bio" in item ? item.profile_bio : null);
  const affiliates = asJsonObject(
    "affiliatesHighlightedLabel" in item ? item.affiliatesHighlightedLabel : null,
  );

  return {
    userId: toBigInt(item.id),
    userName: toString(item.userName),
    displayName: toString(item.name),
    profileUrl: toString(item.url),
    profileImageUrl: toString(item.profilePicture),
    coverImageUrl: toString(item.coverPicture),
    bio: toString(item.description),
    location: toString(item.location),
    isBlueVerified: toBoolean(item.isBlueVerified),
    verifiedType: toString(item.verifiedType),
    isTranslator: toBoolean(item.isTranslator),
    isAutomated: toBoolean(item.isAutomated),
    automatedBy: toString(item.automatedBy),
    possiblySensitive: toBoolean(item.possiblySensitive),
    unavailable: toBoolean(item.unavailable),
    unavailableMessage: toString(item.message),
    unavailableReason: toString(item.unavailableReason),
    followersCount: toBigInt(item.followers),
    followingCount: toBigInt(item.following),
    favouritesCount: toBigInt(item.favouritesCount),
    mediaCount: toBigInt(item.mediaCount),
    statusesCount: toBigInt(item.statusesCount),
    createdAt: parseDate(item.createdAt),
    bioEntities: profileBio,
    affiliatesHighlightedLabel: affiliates,
    pinnedTweetIds: toStringArray(item.pinnedTweetIds),
    withheldCountries: toStringArray(item.withheldInCountries),
  };
}

export function convertTweet(item: TweetItem): TweetData | null {
  const tweetId = toBigInt(item.id);
  const authorId = toBigInt(item.author?.id);
  if (!tweetId || !authorId) return null;

  const createdAt = parseDate(item.createdAt) ?? new Date();
  const raw = asJsonObject(item) ?? {};

  return {
    postId: tweetId,
    authorUserId: authorId,
    createdAt,
    text: toString(item.text),
    lang: toString(item.lang),
    raw,
  };
}
