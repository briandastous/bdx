import { setTimeout as delay } from "node:timers/promises";

class RateLimiter {
  private minIntervalMs: number | null = null;
  private lastRequestAt: number | null = null;
  private queue: Promise<void> = Promise.resolve();

  configure(minIntervalMs: number | null): void {
    if (minIntervalMs === null) return;
    if (this.minIntervalMs === null || minIntervalMs > this.minIntervalMs) {
      this.minIntervalMs = minIntervalMs;
    }
  }

  async wait(): Promise<void> {
    let release: () => void = () => undefined;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.queue;
    this.queue = next;

    await previous;

    const interval = this.minIntervalMs;
    const last = this.lastRequestAt;
    const now = Date.now();

    if (interval !== null && last !== null) {
      const elapsed = now - last;
      if (elapsed < interval) {
        await delay(interval - elapsed);
      }
    }

    this.lastRequestAt = Date.now();
    release();
  }
}

const GLOBAL_RATE_LIMITER = new RateLimiter();

export function configureRateLimit(minIntervalMs: number | null): void {
  GLOBAL_RATE_LIMITER.configure(minIntervalMs);
}

export async function enforceRateLimit(): Promise<void> {
  await GLOBAL_RATE_LIMITER.wait();
}
