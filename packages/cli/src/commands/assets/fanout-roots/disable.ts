import { Command, Flags } from "@oclif/core";
import { loadBaseEnv } from "@bdx/config";
import { disableAssetInstanceFanoutRoot } from "@bdx/db";
import type { AssetInstanceFanoutMode } from "@bdx/db";
import { createDbFromEnv, createLoggerFromEnv, destroyDbSafely } from "../../../lib/context.js";
import {
  getAssetInstanceForParams,
  parseAssetParamsInput,
  resolveAssetSlug,
} from "../../../lib/assets.js";
import { parsePositiveBigInt } from "../../../lib/parsers.js";

const fanoutModes: readonly AssetInstanceFanoutMode[] = ["global_per_item", "scoped_by_source"];

export default class AssetsFanoutRootsDisable extends Command {
  static override description = "Disable a fanout root for an asset instance.";

  static override flags = {
    "source-instance-id": Flags.string({
      description: "Existing source asset instance id (skip source-slug/source-params).",
    }),
    "source-slug": Flags.string({
      description: "Source asset slug (required if source-instance-id omitted).",
    }),
    "source-params": Flags.string({
      description: "JSON params for the source asset (required if source-instance-id omitted).",
    }),
    "target-slug": Flags.string({
      description: "Target asset slug to fan out.",
      required: true,
    }),
    "fanout-mode": Flags.string({
      description: "Fanout mode.",
      options: fanoutModes,
      required: true,
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(AssetsFanoutRootsDisable);
    const env = loadBaseEnv();
    const logger = createLoggerFromEnv(env);
    const db = createDbFromEnv(env);

    try {
      let sourceInstanceId: bigint;
      if (flags["source-instance-id"]) {
        sourceInstanceId = parsePositiveBigInt(flags["source-instance-id"], "source-instance-id");
      } else {
        if (!flags["source-slug"] || !flags["source-params"]) {
          this.error("source-slug and source-params are required when source-instance-id is not provided", {
            exit: 2,
          });
        }
        const sourceSlug = resolveAssetSlug(flags["source-slug"]);
        const sourceParams = parseAssetParamsInput(sourceSlug, flags["source-params"]);
        const sourceInstance = await getAssetInstanceForParams(db, sourceParams);
        if (!sourceInstance) {
          this.error("source asset instance not found for provided params", { exit: 2 });
        }
        sourceInstanceId = sourceInstance.id;
      }

      const targetSlug = resolveAssetSlug(flags["target-slug"]);
      const fanoutMode = flags["fanout-mode"] as AssetInstanceFanoutMode;

      const updated = await disableAssetInstanceFanoutRoot(db, {
        sourceInstanceId,
        targetAssetSlug: targetSlug,
        fanoutMode,
      });

      if (updated === 0) {
        this.log(`source_instance_id=${sourceInstanceId.toString()} already disabled`);
        return;
      }

      this.log(
        [
          `source_instance_id=${sourceInstanceId.toString()}`,
          `target_slug=${targetSlug}`,
          `fanout_mode=${fanoutMode}`,
          "disabled",
        ].join(" "),
      );
    } catch (error) {
      logger.error({ error }, "failed to disable fanout root");
      this.error("failed to disable fanout root", { exit: 1 });
    } finally {
      await destroyDbSafely(db);
    }
  }
}
