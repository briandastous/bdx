import { Command, Flags } from "@oclif/core";
import { loadWorkerEnv } from "@bdx/config";
import { PostsHydrationService } from "@bdx/ingest";
import {
  createDbFromEnv,
  createLoggerFromEnv,
  createTwitterClient,
  destroyDbSafely,
} from "../../lib/context.js";
import { parsePostIdCsv } from "../../lib/parsers.js";

export default class IngestPostsByIds extends Command {
  static override description = "Hydrate one or more X posts by id.";

  static override flags = {
    "post-ids": Flags.string({
      description: "Comma-separated X post ids to hydrate.",
      required: true,
    }),
    force: Flags.boolean({
      description: "Force hydration for existing posts.",
      default: false,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(IngestPostsByIds);
    const postIds = parsePostIdCsv(flags["post-ids"], "post-ids");

    const env = loadWorkerEnv();
    const logger = createLoggerFromEnv(env);
    const db = createDbFromEnv(env);
    const client = createTwitterClient(env);

    try {
      const service = new PostsHydrationService({
        db,
        logger,
        client,
        batchSize: env.twitterapiIo.batchPostsByIdsMax,
        httpSnapshotMaxBytes: env.retention.httpBodyMaxBytes,
      });

      const result = await service.hydratePostsByIds({ postIds, force: flags.force });

      this.log(
        [
          `ingest_event_id=${result.ingestEventId?.toString() ?? "null"}`,
          `requested=${result.requestedPostIds.length}`,
          `hydrated=${result.hydratedPostIds.length}`,
          `skipped=${result.skippedPostIds.length}`,
          `authors=${result.authorUserIds.length}`,
        ].join(" "),
      );
    } finally {
      await destroyDbSafely(db);
    }
  }
}
