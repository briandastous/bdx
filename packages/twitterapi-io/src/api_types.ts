import type { paths } from "@bdx/twitterapi-io-types";

export type UserInfoResponse =
  paths["/twitter/user/info"]["get"]["responses"]["200"]["content"]["application/json"];
export type UserInfoData = NonNullable<UserInfoResponse["data"]>;

export type UserBatchResponse =
  paths["/twitter/user/batch_info_by_ids"]["get"]["responses"]["200"]["content"]["application/json"];
export type UserBatchItem = NonNullable<UserBatchResponse["users"]>[number];

export type FollowersResponse =
  paths["/twitter/user/followers"]["get"]["responses"]["200"]["content"]["application/json"];
export type FollowersItem = NonNullable<FollowersResponse["followers"]>[number];

export type FollowingsResponse =
  paths["/twitter/user/followings"]["get"]["responses"]["200"]["content"]["application/json"];
export type FollowingsItem = NonNullable<FollowingsResponse["followings"]>[number];

export type PostsResponse =
  paths["/twitter/tweet/advanced_search"]["get"]["responses"]["200"]["content"]["application/json"];
export type TweetItem = NonNullable<PostsResponse["tweets"]>[number];
