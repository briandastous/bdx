import type { Db } from "@bdx/db";
import type { Logger } from "@bdx/observability";

export class AssetEngine {
  constructor(private readonly params: { db: Db; logger: Logger }) {}

  tick(signal: AbortSignal): void {
    if (signal.aborted) return;
    this.params.logger.info("engine tick");
  }
}
