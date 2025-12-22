import { setTimeout as delay } from "node:timers/promises";
import type { AssetEngine } from "./engine.js";

export async function runEngineLoop(params: {
  engine: AssetEngine;
  intervalMs: number;
  signal: AbortSignal;
}): Promise<void> {
  while (!params.signal.aborted) {
    const start = Date.now();
    params.engine.tick(params.signal);

    const elapsed = Date.now() - start;
    const sleepMs = Math.max(0, params.intervalMs - elapsed);
    await delay(sleepMs, undefined, { signal: params.signal });
  }
}
