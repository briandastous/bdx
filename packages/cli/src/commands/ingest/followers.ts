import { Command, Flags } from "@oclif/core";
import { loadWorkerEnv } from "@bdx/config";
import { FollowersSyncService } from "@bdx/ingest";
import { createDbFromEnv, createLoggerFromEnv, createTwitterClient, destroyDbSafely } from "../../lib/context.js";
import { parsePositiveBigInt } from "../../lib/parsers.js";

export default class IngestFollowers extends Command {
  static override description = "Run a followers ingest for a target X user id.";

  static override flags = {
    "user-id": Flags.string({
      description: "Target X user id.",
      required: true,
    }),
    mode: Flags.string({
      description: "Sync mode.",
      options: ["full", "incremental"],
      default: "full",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(IngestFollowers);
    const userId = parsePositiveBigInt(flags["user-id"], "user-id");

    const env = loadWorkerEnv();
    const logger = createLoggerFromEnv(env);
    const db = createDbFromEnv(env);
    const client = createTwitterClient(env);

    try {
      const service = new FollowersSyncService({
        db,
        logger,
        client,
        httpSnapshotMaxBytes: env.retention.httpBodyMaxBytes,
      });
      const result =
        flags.mode === "incremental"
          ? await service.syncFollowersIncremental({ targetUserId: userId })
          : await service.syncFollowersFull({ targetUserId: userId });

      this.log(
        [
          `sync_run_id=${result.syncRunId.toString()}`,
          `target_user_id=${result.targetUserId.toString()}`,
          `target_handle=${result.targetHandle}`,
          `followers=${result.followerCount}`,
          `cursor_exhausted=${result.cursorExhausted}`,
        ].join(" "),
      );
    } finally {
      await destroyDbSafely(db);
    }
  }
}
