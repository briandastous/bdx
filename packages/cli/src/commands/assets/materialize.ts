import { Command, Flags } from "@oclif/core";
import { loadWorkerEnv } from "@bdx/config";
import { migrateToLatestWithLock } from "@bdx/db";
import { AssetEngine } from "@bdx/engine";
import {
  createDbFromEnv,
  createLoggerFromEnv,
  createTwitterClient,
  destroyDbSafely,
} from "../../lib/context.js";
import {
  formatAssetParamsForLog,
  parseAssetParamsInput,
  resolveAssetSlug,
} from "../../lib/assets.js";
import { parseAssetInstanceId } from "../../lib/parsers.js";

export default class AssetsMaterialize extends Command {
  static override description = "Materialize a single asset instance (by id or by params).";

  static override flags = {
    "instance-id": Flags.string({
      description: "Existing asset instance id (skip slug/params).",
    }),
    slug: Flags.string({
      description: "Asset slug (required if instance-id omitted).",
    }),
    params: Flags.string({
      description: "JSON params for the asset (required if instance-id omitted).",
    }),
    "trigger-reason": Flags.string({
      description: "Optional trigger reason to record on the materialization.",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(AssetsMaterialize);
    const env = loadWorkerEnv();
    const logger = createLoggerFromEnv(env);
    const db = createDbFromEnv(env);

    try {
      if (env.RUN_MIGRATIONS) {
        await migrateToLatestWithLock(db);
      }

      const twitterClient = createTwitterClient(env);
      const engine = new AssetEngine({
        db,
        logger,
        twitterClient,
        postsMaxQueryLength: env.twitterapiIo.maxQueryLength,
        httpSnapshotMaxBytes: env.retention.httpBodyMaxBytes,
      });

      const triggerReason = flags["trigger-reason"] ?? "cli";

      const result = flags["instance-id"]
        ? await engine.materializeInstanceById(
            parseAssetInstanceId(flags["instance-id"], "instance-id"),
            { triggerReason },
          )
        : await this.materializeFromParams(engine, flags, triggerReason);

      this.log(
        [
          `instance_id=${result.instanceId.toString()}`,
          `materialization_id=${result.materializationId?.toString() ?? "null"}`,
          `status=${result.status}`,
          `output_revision=${result.outputRevision?.toString() ?? "null"}`,
        ].join(" "),
      );
    } finally {
      await destroyDbSafely(db);
    }
  }

  private async materializeFromParams(
    engine: AssetEngine,
    flags: { slug?: string | undefined; params?: string | undefined },
    triggerReason: string,
  ) {
    if (!flags.slug || !flags.params) {
      this.error("slug and params are required when instance-id is not provided", { exit: 2 });
    }
    const assetSlug = resolveAssetSlug(flags.slug);
    const params = parseAssetParamsInput(assetSlug, flags.params);
    const label = formatAssetParamsForLog(params);
    this.log(`materializing params: ${label}`);
    return engine.materializeParams(params, { triggerReason });
  }
}
