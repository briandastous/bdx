import { Command, Flags } from "@oclif/core";
import { loadWorkerEnv } from "@bdx/config";
import { PostsSyncService } from "@bdx/ingest";
import {
  createDbFromEnv,
  createLoggerFromEnv,
  createTwitterClient,
  destroyDbSafely,
} from "../../lib/context.js";
import { parseDate, parseUserId } from "../../lib/parsers.js";

export default class IngestPosts extends Command {
  static override description = "Run a posts ingest for one or more X user ids.";

  static override flags = {
    "user-id": Flags.string({
      description: "Target X user id (repeatable).",
      required: true,
      multiple: true,
    }),
    mode: Flags.string({
      description: "Sync mode.",
      options: ["full", "incremental"],
      default: "full",
    }),
    since: Flags.string({
      description: "ISO timestamp for incremental sync (required when mode=incremental).",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(IngestPosts);
    const userIds = flags["user-id"].map((value, index) => parseUserId(value, `user-id[${index}]`));

    const env = loadWorkerEnv();
    const logger = createLoggerFromEnv(env);
    const db = createDbFromEnv(env);
    const client = createTwitterClient(env);

    try {
      const service = new PostsSyncService({
        db,
        logger,
        client,
        maxQueryLength: env.twitterapiIo.maxQueryLength,
        batchUsersByIdsMax: env.twitterapiIo.batchUsersByIdsMax,
        httpSnapshotMaxBytes: env.retention.httpBodyMaxBytes,
      });

      if (flags.mode === "incremental" && !flags.since) {
        this.error("since is required when mode=incremental", { exit: 2 });
      }

      const result =
        flags.mode === "incremental"
          ? await service.syncPostsIncremental({
              userIds,
              since: parseDate(flags.since ?? "", "since"),
            })
          : await service.syncPostsFull({ userIds });

      this.log(
        [
          `sync_run_id=${result.syncRunId.toString()}`,
          `users=${result.targetUserIds.map((id) => id.toString()).join(",")}`,
          `posts=${result.postCount}`,
          `cursor_exhausted=${result.cursorExhausted}`,
          `synced_since=${result.syncedSince ? result.syncedSince.toISOString() : "null"}`,
        ].join(" "),
      );
    } finally {
      await destroyDbSafely(db);
    }
  }
}
