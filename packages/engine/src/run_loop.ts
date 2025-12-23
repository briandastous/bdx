import { setTimeout as delay } from "node:timers/promises";
import type { AssetEngine } from "./engine.js";

export async function runEngineLoop(params: {
  engine: AssetEngine;
  intervalMs: number;
  signal: AbortSignal;
  singleTick?: boolean;
  onError?: (error: unknown) => void;
}): Promise<void> {
  while (!params.signal.aborted) {
    const start = Date.now();
    try {
      await params.engine.tick(params.signal);
    } catch (error) {
      if (params.onError) {
        params.onError(error);
      } else {
        throw error;
      }
    }

    if (params.singleTick) return;

    const elapsed = Date.now() - start;
    const sleepMs = Math.max(0, params.intervalMs - elapsed);
    try {
      await delay(sleepMs, undefined, { signal: params.signal });
    } catch (error) {
      if (params.signal.aborted) return;
      throw error;
    }
  }
}
