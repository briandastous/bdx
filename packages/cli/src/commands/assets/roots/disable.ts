import { Command, Flags } from "@oclif/core";
import { loadBaseEnv } from "@bdx/config";
import { disableAssetInstanceRoot } from "@bdx/db";
import type { AssetInstanceId } from "@bdx/ids";
import { createDbFromEnv, createLoggerFromEnv, destroyDbSafely } from "../../../lib/context.js";
import {
  getAssetInstanceForParams,
  parseAssetParamsInput,
  resolveAssetSlug,
} from "../../../lib/assets.js";
import { parseAssetInstanceId } from "../../../lib/parsers.js";

export default class AssetsRootsDisable extends Command {
  static override description = "Disable a root asset instance.";

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
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(AssetsRootsDisable);
    const env = loadBaseEnv();
    const logger = createLoggerFromEnv(env);
    const db = createDbFromEnv(env);

    try {
      let instanceId: AssetInstanceId;

      if (flags["instance-id"]) {
        instanceId = parseAssetInstanceId(flags["instance-id"], "instance-id");
      } else {
        if (!flags.slug || !flags.params) {
          this.error("slug and params are required when instance-id is not provided", { exit: 2 });
        }
        const assetSlug = resolveAssetSlug(flags.slug);
        const params = parseAssetParamsInput(assetSlug, flags.params);
        const instance = await getAssetInstanceForParams(db, params);
        if (!instance) {
          this.error("asset instance not found for provided params", { exit: 2 });
        }
        instanceId = instance.id;
      }

      const updated = await disableAssetInstanceRoot(db, instanceId);
      if (updated === 0) {
        this.log(`instance_id=${instanceId.toString()} already disabled`);
        return;
      }
      this.log(`instance_id=${instanceId.toString()} disabled`);
    } catch (error) {
      logger.error({ error }, "failed to disable root");
      this.error("failed to disable root", { exit: 1 });
    } finally {
      await destroyDbSafely(db);
    }
  }
}
