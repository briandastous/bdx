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
    expect(env.twitterapiIo.batchUsersByIdsMax).toBe(100);
    expect(env.twitterapiIo.batchPostsByIdsMax).toBe(100);
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

  it("parses twitterapi.io batch size overrides", () => {
    const env = loadWorkerEnv({
      NODE_ENV: "test",
      LOG_LEVEL: "info",
      DATABASE_URL: "postgres://example",
      TWITTERAPI_IO_TOKEN: "test-token",
      TWITTERAPI_IO_BATCH_USERS_BY_IDS_MAX: "25",
      TWITTERAPI_IO_BATCH_POSTS_BY_IDS_MAX: "75",
    });

    expect(env.twitterapiIo.batchUsersByIdsMax).toBe(25);
    expect(env.twitterapiIo.batchPostsByIdsMax).toBe(75);
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
