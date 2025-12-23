import type { DbOrTx } from "./db.js";
import type { IngestKind } from "./database.js";

const DAY_MS = 86_400_000;

const NON_WEBHOOK_INGEST_KINDS: IngestKind[] = [
  "twitterio_api_user_followers",
  "twitterio_api_user_followings",
  "twitterio_api_users_posts",
];

const WEBHOOK_INGEST_KIND: IngestKind = "ifttt_webhook_new_follow";

export interface RetentionConfig {
  enabled: boolean;
  periodMs: number;
  plannerEventsDays: number;
  ingestEventsDays: number;
  webhookEventsDays: number;
  httpBodyMaxBytes: number;
}

export interface RetentionResult {
  plannerEventsDeleted: number;
  ingestEventsDeleted: number;
  webhookEventsDeleted: number;
}

function cutoffFromDays(days: number, now: Date): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

export async function runRetention(
  db: DbOrTx,
  config: RetentionConfig,
  now: Date = new Date(),
): Promise<RetentionResult> {
  if (!config.enabled) {
    return { plannerEventsDeleted: 0, ingestEventsDeleted: 0, webhookEventsDeleted: 0 };
  }

  const plannerCutoff = cutoffFromDays(config.plannerEventsDays, now);
  const ingestCutoff = cutoffFromDays(config.ingestEventsDays, now);
  const webhookCutoff = cutoffFromDays(config.webhookEventsDays, now);

  const plannerResult = await db
    .deleteFrom("scheduler_planner_events")
    .where("created_at", "<", plannerCutoff)
    .executeTakeFirst();

  const ingestResult = await db
    .deleteFrom("ingest_events")
    .where("ingest_kind", "in", NON_WEBHOOK_INGEST_KINDS)
    .where("created_at", "<", ingestCutoff)
    .executeTakeFirst();

  const webhookResult = await db
    .deleteFrom("ingest_events")
    .where("ingest_kind", "=", WEBHOOK_INGEST_KIND)
    .where("created_at", "<", webhookCutoff)
    .executeTakeFirst();

  return {
    plannerEventsDeleted: Number(plannerResult.numDeletedRows),
    ingestEventsDeleted: Number(ingestResult.numDeletedRows),
    webhookEventsDeleted: Number(webhookResult.numDeletedRows),
  };
}
