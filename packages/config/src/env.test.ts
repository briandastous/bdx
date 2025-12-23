import { describe, expect, it } from "vitest";
import { loadWorkerEnv } from "./env.js";

describe("loadWorkerEnv", () => {
  it("defaults RUN_MIGRATIONS to true", () => {
    const env = loadWorkerEnv({
      NODE_ENV: "test",
      LOG_LEVEL: "info",
      DATABASE_URL: "postgres://example",
      TWITTERAPI_IO_TOKEN: "test-token",
    });

    expect(env.DEPLOY_ENV).toBe("development");
    expect(env.RUN_MIGRATIONS).toBe(true);
  });

  it("parses RUN_MIGRATIONS=false", () => {
    const env = loadWorkerEnv({
      NODE_ENV: "test",
      LOG_LEVEL: "info",
      DATABASE_URL: "postgres://example",
      RUN_MIGRATIONS: "false",
      TWITTERAPI_IO_TOKEN: "test-token",
    });

    expect(env.RUN_MIGRATIONS).toBe(false);
  });

  it("defaults DEPLOY_ENV to production when NODE_ENV=production", () => {
    const env = loadWorkerEnv({
      NODE_ENV: "production",
      LOG_LEVEL: "info",
      DATABASE_URL: "postgres://example",
      TWITTERAPI_IO_TOKEN: "test-token",
    });

    expect(env.DEPLOY_ENV).toBe("production");
  });
});
