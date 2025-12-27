import { Command, Flags } from "@oclif/core";
import { loadBaseEnv, loadWorkerEnv } from "@bdx/config";
import { enableAssetInstanceRoot, replaceSpecifiedUsersInputs } from "@bdx/db";
import type { AssetInstanceId } from "@bdx/ids";
import { UsersByIdsIngestService } from "@bdx/ingest";
import {
  createDbFromEnv,
  createLoggerFromEnv,
  createTwitterClient,
  destroyDbSafely,
} from "../../../lib/context.js";
import {
  ensureAssetInstance,
  formatAssetParamsForLog,
  parseAssetParamsInput,
  resolveAssetSlug,
} from "../../../lib/assets.js";
import { parseAssetInstanceId, parseUserIdCsv } from "../../../lib/parsers.js";

export default class AssetsRootsEnable extends Command {
  static override description = "Enable a root asset instance.";

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
    "specified-user-ids": Flags.string({
      description: "Comma-separated X user ids for segment_specified_users inputs.",
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(AssetsRootsEnable);
    const env = loadBaseEnv();
    const logger = createLoggerFromEnv(env);
    const db = createDbFromEnv(env);

    try {
      let instanceId: AssetInstanceId;
      let paramsLabel: string | null = null;

      if (flags["instance-id"]) {
        instanceId = parseAssetInstanceId(flags["instance-id"], "instance-id");
      } else {
        if (!flags.slug || !flags.params) {
          this.error("slug and params are required when instance-id is not provided", { exit: 2 });
        }
        const assetSlug = resolveAssetSlug(flags.slug);
        const params = parseAssetParamsInput(assetSlug, flags.params);
        paramsLabel = formatAssetParamsForLog(params);
        const instance = await ensureAssetInstance(db, params);
        instanceId = instance.id;

        if (flags["specified-user-ids"]) {
          if (params.assetSlug !== "segment_specified_users") {
            this.error("specified-user-ids is only valid for segment_specified_users", { exit: 2 });
          }
          const ids = parseUserIdCsv(flags["specified-user-ids"], "specified-user-ids");
          const workerEnv = loadWorkerEnv();
          const twitterClient = createTwitterClient(workerEnv);
          const usersByIdsIngest = new UsersByIdsIngestService({
            db,
            logger,
            client: twitterClient,
            batchSize: workerEnv.twitterapiIo.batchUsersByIdsMax,
          });
          await usersByIdsIngest.ingestUsersByIds({ userIds: ids });
          await replaceSpecifiedUsersInputs(db, { instanceId, userIds: ids });
        }
      }

      const root = await enableAssetInstanceRoot(db, instanceId);
      this.log(
        [
          `root_id=${root.id.toString()}`,
          `instance_id=${root.instanceId.toString()}`,
          `params=${paramsLabel ?? "n/a"}`,
        ].join(" "),
      );
    } catch (error) {
      logger.error({ error }, "failed to enable root");
      this.error("failed to enable root", { exit: 1 });
    } finally {
      await destroyDbSafely(db);
    }
  }
}
