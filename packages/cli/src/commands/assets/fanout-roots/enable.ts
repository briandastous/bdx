import { Command, Flags } from "@oclif/core";
import { loadBaseEnv } from "@bdx/config";
import { enableAssetInstanceFanoutRoot } from "@bdx/db";
import type { AssetInstanceFanoutMode } from "@bdx/db";
import type { AssetInstanceId } from "@bdx/ids";
import { createDbFromEnv, createLoggerFromEnv, destroyDbSafely } from "../../../lib/context.js";
import {
  ensureAssetInstance,
  parseAssetParamsInput,
  resolveAssetSlug,
} from "../../../lib/assets.js";
import { parseAssetInstanceId } from "../../../lib/parsers.js";

const fanoutModes: readonly AssetInstanceFanoutMode[] = ["global_per_item", "scoped_by_source"];

export default class AssetsFanoutRootsEnable extends Command {
  static override description = "Enable a fanout root for an asset instance.";

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
    const { flags } = await this.parse(AssetsFanoutRootsEnable);
    const env = loadBaseEnv();
    const logger = createLoggerFromEnv(env);
    const db = createDbFromEnv(env);

    try {
      let sourceInstanceId: AssetInstanceId;
      if (flags["source-instance-id"]) {
        sourceInstanceId = parseAssetInstanceId(flags["source-instance-id"], "source-instance-id");
      } else {
        if (!flags["source-slug"] || !flags["source-params"]) {
          this.error(
            "source-slug and source-params are required when source-instance-id is not provided",
            {
              exit: 2,
            },
          );
        }
        const sourceSlug = resolveAssetSlug(flags["source-slug"]);
        const sourceParams = parseAssetParamsInput(sourceSlug, flags["source-params"]);
        const sourceInstance = await ensureAssetInstance(db, sourceParams);
        sourceInstanceId = sourceInstance.id;
      }

      const targetSlug = resolveAssetSlug(flags["target-slug"]);
      const fanoutMode = flags["fanout-mode"] as AssetInstanceFanoutMode;

      const root = await enableAssetInstanceFanoutRoot(db, {
        sourceInstanceId,
        targetAssetSlug: targetSlug,
        fanoutMode,
      });

      this.log(
        [
          `fanout_root_id=${root.id.toString()}`,
          `source_instance_id=${root.sourceInstanceId.toString()}`,
          `target_slug=${root.targetAssetSlug}`,
          `fanout_mode=${root.fanoutMode}`,
        ].join(" "),
      );
    } catch (error) {
      logger.error({ error }, "failed to enable fanout root");
      this.error("failed to enable fanout root", { exit: 1 });
    } finally {
      await destroyDbSafely(db);
    }
  }
}
