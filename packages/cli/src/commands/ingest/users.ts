import { Command, Flags } from "@oclif/core";
import { loadWorkerEnv } from "@bdx/config";
import { UsersHydrationService } from "@bdx/ingest";
import {
  createDbFromEnv,
  createLoggerFromEnv,
  createTwitterClient,
  destroyDbSafely,
} from "../../lib/context.js";
import { parseUserIdCsv } from "../../lib/parsers.js";

export default class IngestUsers extends Command {
  static override description = "Hydrate one or more X users by id.";

  static override flags = {
    "user-ids": Flags.string({
      description: "Comma-separated X user ids to hydrate.",
      required: true,
    }),
    force: Flags.boolean({
      description: "Force hydration for existing users.",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(IngestUsers);
    const userIds = parseUserIdCsv(flags["user-ids"], "user-ids");

    const env = loadWorkerEnv();
    const logger = createLoggerFromEnv(env);
    const db = createDbFromEnv(env);
    const client = createTwitterClient(env);

    try {
      const service = new UsersHydrationService({
        db,
        logger,
        client,
        batchSize: env.twitterapiIo.batchUsersByIdsMax,
        httpSnapshotMaxBytes: env.retention.httpBodyMaxBytes,
      });

      const result = await service.hydrateUsersByIds({ userIds, force: flags.force });

      this.log(
        [
          `ingest_event_id=${result.ingestEventId?.toString() ?? "null"}`,
          `requested=${result.requestedUserIds.length}`,
          `hydrated=${result.hydratedUserIds.length}`,
          `skipped=${result.skippedUserIds.length}`,
        ].join(" "),
      );
    } finally {
      await destroyDbSafely(db);
    }
  }
}
