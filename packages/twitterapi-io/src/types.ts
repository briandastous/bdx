import type { PostId, UserId } from "@bdx/ids";

export type JsonPrimitive = boolean | null | number | string;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject {
  [key: string]: JsonValue;
}
export type JsonArray = JsonValue[];

export interface RequestSnapshot extends JsonObject {
  method: string;
  url: string;
  params?: Record<string, JsonPrimitive>;
  headers: Record<string, string>;
}

export interface ResponseSnapshot extends JsonObject {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export interface XUserData {
  userId: UserId | null;
  userName: string | null;
  displayName: string | null;
  profileUrl: string | null;
  profileImageUrl: string | null;
  coverImageUrl: string | null;
  bio: string | null;
  location: string | null;
  isBlueVerified: boolean | null;
  verifiedType: string | null;
  isTranslator: boolean | null;
  isAutomated: boolean | null;
  automatedBy: string | null;
  possiblySensitive: boolean | null;
  unavailable: boolean | null;
  unavailableMessage: string | null;
  unavailableReason: string | null;
  followersCount: bigint | null;
  followingCount: bigint | null;
  favouritesCount: bigint | null;
  mediaCount: bigint | null;
  statusesCount: bigint | null;
  createdAt: Date | null;
  bioEntities: JsonObject | null;
  affiliatesHighlightedLabel: JsonObject | null;
  pinnedTweetIds: string[] | null;
  withheldCountries: string[] | null;
}

export interface FollowersPage {
  followers: XUserData[];
  nextCursor: string | null;
  hasNextPage: boolean;
  rawResponse: JsonObject;
  request: RequestSnapshot;
  response: ResponseSnapshot;
}

export interface FollowingsPage {
  followings: XUserData[];
  nextCursor: string | null;
  hasNextPage: boolean;
  rawResponse: JsonObject;
  request: RequestSnapshot;
  response: ResponseSnapshot;
}

export interface TweetData {
  postId: PostId;
  authorUserId: UserId;
  createdAt: Date;
  text: string | null;
  lang: string | null;
  raw: JsonObject;
}

export interface PostsPage {
  posts: TweetData[];
  nextCursor: string | null;
  hasNextPage: boolean;
  rawResponse: JsonObject;
  request: RequestSnapshot;
  response: ResponseSnapshot;
}
