import { describe, expect, it } from "vitest";
import { loadWorkerEnv } from "./env.js";

describe("loadWorkerEnv", () => {
  it("defaults RUN_MIGRATIONS to true", () => {
    const env = loadWorkerEnv({
      NODE_ENV: "test",
      LOG_LEVEL: "info",
      DATABASE_URL: "postgres://example",
    });

    expect(env.RUN_MIGRATIONS).toBe(true);
  });

  it("parses RUN_MIGRATIONS=false", () => {
    const env = loadWorkerEnv({
      NODE_ENV: "test",
      LOG_LEVEL: "info",
      DATABASE_URL: "postgres://example",
      RUN_MIGRATIONS: "false",
    });

    expect(env.RUN_MIGRATIONS).toBe(false);
  });
});

