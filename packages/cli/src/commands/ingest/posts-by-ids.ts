import { Command, Flags } from "@oclif/core";
import { loadWorkerEnv } from "@bdx/config";
import { PostsByIdsIngestService } from "@bdx/ingest";
import {
  createDbFromEnv,
  createLoggerFromEnv,
  createTwitterClient,
  destroyDbSafely,
} from "../../lib/context.js";
import { parsePostIdCsv } from "../../lib/parsers.js";

export default class IngestPostsByIds extends Command {
  static override description = "Ingest one or more X posts by id.";

  static override flags = {
    "post-ids": Flags.string({
      description: "Comma-separated X post ids to ingest.",
      required: true,
    }),
    force: Flags.boolean({
      description: "Force ingest for existing posts.",
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
      const service = new PostsByIdsIngestService({
        db,
        logger,
        client,
        batchSize: env.twitterapiIo.batchPostsByIdsMax,
        httpSnapshotMaxBytes: env.retention.httpBodyMaxBytes,
      });

      const result = await service.ingestPostsByIds({ postIds, force: flags.force });

      this.log(
        [
          `ingest_event_id=${result.ingestEventId?.toString() ?? "null"}`,
          `requested=${result.requestedPostIds.length}`,
          `ingested=${result.ingestedPostIds.length}`,
          `skipped=${result.skippedPostIds.length}`,
          `authors=${result.authorUserIds.length}`,
        ].join(" "),
      );
    } finally {
      await destroyDbSafely(db);
    }
  }
}
