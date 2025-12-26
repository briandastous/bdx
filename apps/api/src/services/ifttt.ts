import type { Db, IngestKind, JsonValue } from "@bdx/db";
import type { IngestEventId, UserId } from "@bdx/ids";
import {
  insertWebhookFollowEvent,
  upsertFollows,
  upsertFollowsMeta,
  upsertUserProfile,
  upsertUsersMeta,
  withTransaction,
} from "@bdx/db";
import { userProfileInputFromXUser } from "@bdx/ingest";
import type { XUserData } from "@bdx/twitterapi-io";

export interface WebhookFollowResult {
  ingestEventId: IngestEventId;
  ingestKind: IngestKind;
  targetUserId: UserId;
  followerUserId: UserId;
  followerHandle: string;
}

export async function ingestIftttNewFollower(params: {
  db: Db;
  targetUserId: UserId;
  followerHandle: string;
  followerProfile: XUserData;
  rawPayload: JsonValue | null;
}): Promise<WebhookFollowResult> {
  const followerUserId = params.followerProfile.userId;
  const followerUserHandle = params.followerProfile.userName;

  if (followerUserId == null) {
    throw new Error("Follower profile missing userId");
  }
  if (followerUserHandle == null || followerUserHandle.trim() === "") {
    throw new Error("Follower profile missing handle");
  }

  const now = new Date();

  return withTransaction(params.db, async (trx) => {
    const ingestEvent = await insertWebhookFollowEvent(trx, "ifttt_webhook_new_follow", {
      targetUserId: params.targetUserId,
      followerUserId,
      followerHandle: params.followerHandle,
      rawPayload: params.rawPayload,
    });

    const { profile } = userProfileInputFromXUser({
      user: params.followerProfile,
      ingestEventId: ingestEvent.id,
      ingestKind: ingestEvent.ingestKind,
      updatedAt: now,
    });
    if (profile != null) {
      await upsertUserProfile(trx, profile);
    }

    await upsertFollows(trx, [{ targetId: params.targetUserId, followerId: followerUserId }]);
    await upsertFollowsMeta(trx, [
      {
        targetId: params.targetUserId,
        followerId: followerUserId,
        ingestEventId: ingestEvent.id,
        ingestKind: ingestEvent.ingestKind,
        updatedAt: now,
      },
    ]);
    await upsertUsersMeta(trx, [
      {
        userId: followerUserId,
        ingestEventId: ingestEvent.id,
        ingestKind: ingestEvent.ingestKind,
        updatedAt: now,
      },
    ]);

    return {
      ingestEventId: ingestEvent.id,
      ingestKind: ingestEvent.ingestKind,
      targetUserId: params.targetUserId,
      followerUserId,
      followerHandle: followerUserHandle,
    };
  });
}
