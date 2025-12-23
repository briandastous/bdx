import { Command, Flags } from "@oclif/core";
import { loadWorkerEnv } from "@bdx/config";
import { FollowingsSyncService } from "@bdx/ingest";
import {
  createDbFromEnv,
  createLoggerFromEnv,
  createTwitterClient,
  destroyDbSafely,
} from "../../lib/context.js";
import { parseUserId } from "../../lib/parsers.js";

export default class IngestFollowings extends Command {
  static override description = "Run a followings ingest for a source X user id.";

  static override flags = {
    "user-id": Flags.string({
      description: "Source X user id.",
      required: true,
    }),
    mode: Flags.string({
      description: "Sync mode.",
      options: ["full", "incremental"],
      default: "full",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(IngestFollowings);
    const userId = parseUserId(flags["user-id"], "user-id");

    const env = loadWorkerEnv();
    const logger = createLoggerFromEnv(env);
    const db = createDbFromEnv(env);
    const client = createTwitterClient(env);

    try {
      const service = new FollowingsSyncService({
        db,
        logger,
        client,
        httpSnapshotMaxBytes: env.retention.httpBodyMaxBytes,
      });
      const result =
        flags.mode === "incremental"
          ? await service.syncFollowingsIncremental({ sourceUserId: userId })
          : await service.syncFollowingsFull({ sourceUserId: userId });

      this.log(
        [
          `sync_run_id=${result.syncRunId.toString()}`,
          `source_user_id=${result.sourceUserId.toString()}`,
          `source_handle=${result.sourceHandle}`,
          `followings=${result.followingCount}`,
          `cursor_exhausted=${result.cursorExhausted}`,
        ].join(" "),
      );
    } finally {
      await destroyDbSafely(db);
    }
  }
}
