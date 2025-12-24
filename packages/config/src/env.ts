import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { UserId } from "@bdx/ids";

const nodeEnvSchema = z.enum(["development", "test", "production"]).default("development");
const deployEnvSchema = z.enum(["development", "staging", "production"]);
const logLevelSchema = z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]);
const bigintSchema = z.union([z.string(), z.number().int(), z.bigint()]).transform((value) => {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error("Expected a safe integer for bigint input");
    }
    return BigInt(value);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error("Expected a bigint string");
  }
  return BigInt(trimmed);
});

export type NodeEnv = z.infer<typeof nodeEnvSchema>;
export type DeployEnv = z.infer<typeof deployEnvSchema>;
export type LogLevel = z.infer<typeof logLevelSchema>;

const xConfigInputSchema = z
  .object({
    self: z
      .object({
        userId: bigintSchema.optional(),
        handle: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .optional();

const twitterApiConfigInputSchema = z
  .object({
    baseUrl: z.string().min(1).optional(),
    rateLimitQps: z.number().positive().optional(),
    maxQueryLength: z.number().int().positive().optional(),
  })
  .strict()
  .optional();

const retentionConfigInputSchema = z
  .object({
    enabled: z.boolean().optional(),
    periodMs: z.number().int().positive().optional(),
    plannerEventsDays: z.number().int().positive().optional(),
    ingestEventsDays: z.number().int().positive().optional(),
    webhookEventsDays: z.number().int().positive().optional(),
    httpBodyMaxBytes: z.number().int().positive().optional(),
  })
  .strict()
  .optional();

const xConfigSchema = z
  .object({
    self: z
      .object({
        userId: bigintSchema.optional(),
        handle: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .default({});

const twitterApiConfigSchema = z
  .object({
    baseUrl: z.string().min(1).default("https://api.twitterapi.io"),
    rateLimitQps: z.number().positive().default(1),
    maxQueryLength: z.number().int().positive().default(512),
  })
  .strict()
  .default({});

const retentionConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    periodMs: z.number().int().positive().default(86_400_000),
    plannerEventsDays: z.number().int().positive().default(30),
    ingestEventsDays: z.number().int().positive().default(90),
    webhookEventsDays: z.number().int().positive().default(180),
    httpBodyMaxBytes: z.number().int().positive().default(2048),
  })
  .strict()
  .default({});

const yamlConfigInputSchema = z
  .object({
    logLevel: logLevelSchema.optional(),
    db: z
      .object({
        maxConnections: z.number().int().positive().optional(),
        idleTimeoutMs: z.number().int().nonnegative().optional(),
        connectTimeoutMs: z.number().int().positive().optional(),
        maxLifetimeMs: z.number().int().positive().optional(),
        statementTimeoutMs: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
    api: z
      .object({
        host: z.string().optional(),
        port: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
    worker: z
      .object({
        engineTickIntervalMs: z.number().int().positive().optional(),
        runMigrations: z.boolean().optional(),
        healthPort: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
    x: xConfigInputSchema,
    twitterapiIo: twitterApiConfigInputSchema,
    retention: retentionConfigInputSchema,
  })
  .strict();

const yamlConfigSchema = z
  .object({
    logLevel: logLevelSchema.default("info"),
    db: z
      .object({
        maxConnections: z.number().int().positive().default(10),
        idleTimeoutMs: z.number().int().nonnegative().default(60_000),
        connectTimeoutMs: z.number().int().positive().default(10_000),
        maxLifetimeMs: z.number().int().positive().default(3_600_000),
        statementTimeoutMs: z.number().int().nonnegative().default(30_000),
      })
      .strict()
      .default({}),
    api: z
      .object({
        host: z.string().default("0.0.0.0"),
        port: z.number().int().positive().default(3000),
      })
      .strict()
      .default({}),
    worker: z
      .object({
        engineTickIntervalMs: z.number().int().positive().default(60_000),
        runMigrations: z.boolean().default(true),
        healthPort: z.number().int().positive().nullable().default(null),
      })
      .strict()
      .default({}),
    x: xConfigSchema,
    twitterapiIo: twitterApiConfigSchema,
    retention: retentionConfigSchema,
  })
  .strict();

type YamlConfig = z.infer<typeof yamlConfigSchema>;

export interface DbConfig {
  maxConnections: number;
  idleTimeoutMs: number;
  connectTimeoutMs: number;
  maxLifetimeMs: number;
  statementTimeoutMs: number;
}

export interface XSelfConfig {
  userId: UserId;
  handle: string;
}

export interface TwitterApiConfig {
  token: string;
  baseUrl: string;
  rateLimitQps: number;
  maxQueryLength: number;
}

export interface RetentionConfig {
  enabled: boolean;
  periodMs: number;
  plannerEventsDays: number;
  ingestEventsDays: number;
  webhookEventsDays: number;
  httpBodyMaxBytes: number;
}

export interface BaseEnv {
  NODE_ENV: NodeEnv;
  DEPLOY_ENV: DeployEnv;
  LOG_LEVEL: LogLevel;
  DATABASE_URL: string;
  db: DbConfig;
}

export interface ApiEnv extends BaseEnv {
  HOST: string;
  PORT: number;
  WEBHOOK_TOKEN: string;
  x: {
    self: XSelfConfig;
  };
  twitterapiIo: TwitterApiConfig;
}

export interface WorkerEnv extends BaseEnv {
  ENGINE_TICK_INTERVAL_MS: number;
  RUN_MIGRATIONS: boolean;
  ENGINE_SINGLE_TICK: boolean;
  WORKER_HEALTH_PORT: number | null;
  retention: RetentionConfig;
  x: {
    self: XSelfConfig;
  };
  twitterapiIo: TwitterApiConfig;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveRepoRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "../../..");
}

function readYamlObject(filePath: string): Record<string, unknown> {
  let contents: string;
  try {
    contents = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    throw new Error(`Failed to read config file: ${filePath}`, { cause: error });
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(contents);
  } catch (error) {
    throw new Error(`Failed to parse YAML: ${filePath}`, { cause: error });
  }

  if (parsed === null || parsed === undefined) return {};
  if (!isPlainObject(parsed)) {
    throw new Error(`Expected YAML config to be a mapping/object: ${filePath}`);
  }
  return parsed;
}

function deepMerge(
  baseValue: Record<string, unknown>,
  overrideValue: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...baseValue };
  for (const [key, override] of Object.entries(overrideValue)) {
    const base = merged[key];
    if (isPlainObject(base) && isPlainObject(override)) {
      merged[key] = deepMerge(base, override);
      continue;
    }
    merged[key] = override;
  }
  return merged;
}

function loadYamlConfig(params: { deployEnv: DeployEnv; nodeEnv: NodeEnv }): YamlConfig {
  const repoRoot = resolveRepoRoot();
  const basePath = path.join(repoRoot, "config", "base.yaml");
  const envPath = path.join(repoRoot, "config", "env", `${params.deployEnv}.yaml`);

  const baseRaw = yamlConfigInputSchema.parse(readYamlObject(basePath));
  const envRaw =
    params.nodeEnv === "test" ? {} : yamlConfigInputSchema.parse(readYamlObject(envPath));
  return yamlConfigSchema.parse(deepMerge(baseRaw, envRaw));
}

function resolveDeployEnv(params: {
  nodeEnv: NodeEnv;
  deployEnv: DeployEnv | undefined;
}): DeployEnv {
  if (params.deployEnv) return params.deployEnv;
  return params.nodeEnv === "production" ? "production" : "development";
}

const baseEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  DEPLOY_ENV: deployEnvSchema.optional(),
  DATABASE_URL: z.string().min(1),
});

const baseOverridesEnvSchema = z.object({ LOG_LEVEL: logLevelSchema.optional() });
const dbOverridesEnvSchema = z
  .object({
    DB_MAX_CONNECTIONS: z.coerce.number().int().positive().optional(),
    DB_IDLE_TIMEOUT_MS: z.coerce.number().int().nonnegative().optional(),
    DB_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().optional(),
    DB_MAX_LIFETIME_MS: z.coerce.number().int().positive().optional(),
    DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().nonnegative().optional(),
  })
  .strip();

const xOverridesEnvSchema = z
  .object({
    X_SELF_USER_ID: bigintSchema.optional(),
    X_SELF_HANDLE: z.string().min(1).optional(),
  })
  .strip();

const twitterApiOverridesEnvSchema = z
  .object({
    TWITTERAPI_IO_BASE_URL: z.string().min(1).optional(),
    TWITTERAPI_IO_RATE_LIMIT_QPS: z.coerce.number().positive().optional(),
    TWITTERAPI_IO_MAX_QUERY_LENGTH: z.coerce.number().int().positive().optional(),
  })
  .strip();

type ParsedBaseEnv = z.infer<typeof baseEnvSchema>;
type ResolvedBaseEnv = Omit<ParsedBaseEnv, "DEPLOY_ENV"> & { DEPLOY_ENV: DeployEnv };

function loadBaseParts(env: NodeJS.ProcessEnv): { base: ResolvedBaseEnv; yaml: YamlConfig } {
  const base = baseEnvSchema.parse(env);
  const deployEnv = resolveDeployEnv({ nodeEnv: base.NODE_ENV, deployEnv: base.DEPLOY_ENV });
  const yaml = loadYamlConfig({ deployEnv, nodeEnv: base.NODE_ENV });
  return { base: { ...base, DEPLOY_ENV: deployEnv }, yaml };
}

function resolveDbConfig(yaml: YamlConfig, env: NodeJS.ProcessEnv): DbConfig {
  const overrides = dbOverridesEnvSchema.parse(env);
  return {
    maxConnections: overrides.DB_MAX_CONNECTIONS ?? yaml.db.maxConnections,
    idleTimeoutMs: overrides.DB_IDLE_TIMEOUT_MS ?? yaml.db.idleTimeoutMs,
    connectTimeoutMs: overrides.DB_CONNECT_TIMEOUT_MS ?? yaml.db.connectTimeoutMs,
    maxLifetimeMs: overrides.DB_MAX_LIFETIME_MS ?? yaml.db.maxLifetimeMs,
    statementTimeoutMs: overrides.DB_STATEMENT_TIMEOUT_MS ?? yaml.db.statementTimeoutMs,
  };
}

function resolveXSelfConfig(yaml: YamlConfig, env: NodeJS.ProcessEnv): XSelfConfig {
  const overrides = xOverridesEnvSchema.parse(env);
  const userId = overrides.X_SELF_USER_ID ?? yaml.x.self?.userId;
  const handle = overrides.X_SELF_HANDLE ?? yaml.x.self?.handle;

  if (userId === undefined || handle === undefined) {
    throw new Error(
      "Missing X self config: set X_SELF_USER_ID and X_SELF_HANDLE (env) or config x.self.userId/handle",
    );
  }

  return { userId: UserId(userId), handle };
}

function resolveTwitterApiConfig(
  yaml: YamlConfig,
  env: NodeJS.ProcessEnv,
  token: string,
): TwitterApiConfig {
  const overrides = twitterApiOverridesEnvSchema.parse(env);
  return {
    token,
    baseUrl: overrides.TWITTERAPI_IO_BASE_URL ?? yaml.twitterapiIo.baseUrl,
    rateLimitQps: overrides.TWITTERAPI_IO_RATE_LIMIT_QPS ?? yaml.twitterapiIo.rateLimitQps,
    maxQueryLength: overrides.TWITTERAPI_IO_MAX_QUERY_LENGTH ?? yaml.twitterapiIo.maxQueryLength,
  };
}

function resolveRetentionConfig(yaml: YamlConfig, env: NodeJS.ProcessEnv): RetentionConfig {
  const overrides = retentionOverridesEnvSchema.parse(env);
  return {
    enabled: overrides.RETENTION_ENABLED ?? yaml.retention.enabled,
    periodMs: overrides.RETENTION_PERIOD_MS ?? yaml.retention.periodMs,
    plannerEventsDays: overrides.RETENTION_PLANNER_EVENTS_DAYS ?? yaml.retention.plannerEventsDays,
    ingestEventsDays: overrides.RETENTION_INGEST_EVENTS_DAYS ?? yaml.retention.ingestEventsDays,
    webhookEventsDays: overrides.RETENTION_WEBHOOK_EVENTS_DAYS ?? yaml.retention.webhookEventsDays,
    httpBodyMaxBytes: overrides.RETENTION_HTTP_BODY_MAX_BYTES ?? yaml.retention.httpBodyMaxBytes,
  };
}

export function loadBaseEnv(env: NodeJS.ProcessEnv = process.env): BaseEnv {
  const { base, yaml } = loadBaseParts(env);
  const overrides = baseOverridesEnvSchema.parse(env);

  return {
    NODE_ENV: base.NODE_ENV,
    DEPLOY_ENV: base.DEPLOY_ENV,
    DATABASE_URL: base.DATABASE_URL,
    LOG_LEVEL: overrides.LOG_LEVEL ?? yaml.logLevel,
    db: resolveDbConfig(yaml, env),
  };
}

const apiSecretsEnvSchema = z.object({
  WEBHOOK_TOKEN: z.string().min(1),
  TWITTERAPI_IO_TOKEN: z.string().min(1),
});
const apiOverridesEnvSchema = z
  .object({
    HOST: z.string().min(1).optional(),
    PORT: z.coerce.number().int().positive().optional(),
  })
  .strip();

export function loadApiEnv(env: NodeJS.ProcessEnv = process.env): ApiEnv {
  const { base, yaml } = loadBaseParts(env);
  const baseOverrides = baseOverridesEnvSchema.parse(env);
  const dbConfig = resolveDbConfig(yaml, env);
  const baseEnv: BaseEnv = {
    NODE_ENV: base.NODE_ENV,
    DEPLOY_ENV: base.DEPLOY_ENV,
    DATABASE_URL: base.DATABASE_URL,
    LOG_LEVEL: baseOverrides.LOG_LEVEL ?? yaml.logLevel,
    db: dbConfig,
  };

  const secrets = apiSecretsEnvSchema.parse(env);
  const overrides = apiOverridesEnvSchema.parse(env);
  const xSelf = resolveXSelfConfig(yaml, env);
  const twitterapiIo = resolveTwitterApiConfig(yaml, env, secrets.TWITTERAPI_IO_TOKEN);

  return {
    ...baseEnv,
    HOST: overrides.HOST ?? yaml.api.host,
    PORT: overrides.PORT ?? yaml.api.port,
    WEBHOOK_TOKEN: secrets.WEBHOOK_TOKEN,
    x: { self: xSelf },
    twitterapiIo,
  };
}

const optionalBooleanFromString = z
  .string()
  .optional()
  .transform((value) => (value === undefined ? undefined : value.trim().toLowerCase()))
  .refine(
    (value) =>
      value === undefined ||
      value === "true" ||
      value === "false" ||
      value === "1" ||
      value === "0",
    { message: "Expected a boolean string (true/false/1/0)" },
  )
  .transform((value) => (value === undefined ? undefined : value === "true" || value === "1"));

const workerOverridesEnvSchema = z
  .object({
    ENGINE_TICK_INTERVAL_MS: z.coerce.number().int().positive().optional(),
    RUN_MIGRATIONS: optionalBooleanFromString,
    ENGINE_SINGLE_TICK: optionalBooleanFromString,
    WORKER_HEALTH_PORT: z.coerce.number().int().positive().optional(),
  })
  .strip();

const retentionOverridesEnvSchema = z
  .object({
    RETENTION_ENABLED: optionalBooleanFromString,
    RETENTION_PERIOD_MS: z.coerce.number().int().positive().optional(),
    RETENTION_PLANNER_EVENTS_DAYS: z.coerce.number().int().positive().optional(),
    RETENTION_INGEST_EVENTS_DAYS: z.coerce.number().int().positive().optional(),
    RETENTION_WEBHOOK_EVENTS_DAYS: z.coerce.number().int().positive().optional(),
    RETENTION_HTTP_BODY_MAX_BYTES: z.coerce.number().int().positive().optional(),
  })
  .strip();

const workerSecretsEnvSchema = z.object({
  TWITTERAPI_IO_TOKEN: z.string().min(1),
});

export function loadWorkerEnv(env: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const { base, yaml } = loadBaseParts(env);
  const baseOverrides = baseOverridesEnvSchema.parse(env);
  const dbConfig = resolveDbConfig(yaml, env);
  const baseEnv: BaseEnv = {
    NODE_ENV: base.NODE_ENV,
    DEPLOY_ENV: base.DEPLOY_ENV,
    DATABASE_URL: base.DATABASE_URL,
    LOG_LEVEL: baseOverrides.LOG_LEVEL ?? yaml.logLevel,
    db: dbConfig,
  };

  const overrides = workerOverridesEnvSchema.parse(env);
  const secrets = workerSecretsEnvSchema.parse(env);
  const xSelf = resolveXSelfConfig(yaml, env);
  const twitterapiIo = resolveTwitterApiConfig(yaml, env, secrets.TWITTERAPI_IO_TOKEN);
  const retention = resolveRetentionConfig(yaml, env);

  return {
    ...baseEnv,
    ENGINE_TICK_INTERVAL_MS: overrides.ENGINE_TICK_INTERVAL_MS ?? yaml.worker.engineTickIntervalMs,
    RUN_MIGRATIONS: overrides.RUN_MIGRATIONS ?? yaml.worker.runMigrations,
    ENGINE_SINGLE_TICK: overrides.ENGINE_SINGLE_TICK ?? false,
    WORKER_HEALTH_PORT: overrides.WORKER_HEALTH_PORT ?? yaml.worker.healthPort,
    retention,
    x: { self: xSelf },
    twitterapiIo,
  };
}
