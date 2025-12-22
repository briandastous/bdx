import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

const nodeEnvSchema = z.enum(["development", "test", "production"]).default("development");
const deployEnvSchema = z.enum(["development", "staging", "production"]);
const logLevelSchema = z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]);

export type NodeEnv = z.infer<typeof nodeEnvSchema>;
export type DeployEnv = z.infer<typeof deployEnvSchema>;
export type LogLevel = z.infer<typeof logLevelSchema>;

const yamlConfigInputSchema = z
  .object({
    logLevel: logLevelSchema.optional(),
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
      })
      .strict()
      .optional(),
  })
  .strict();

const yamlConfigSchema = z
  .object({
    logLevel: logLevelSchema.default("info"),
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
      })
      .strict()
      .default({}),
  })
  .strict();

type YamlConfig = z.infer<typeof yamlConfigSchema>;

export interface BaseEnv {
  NODE_ENV: NodeEnv;
  DEPLOY_ENV: DeployEnv;
  LOG_LEVEL: LogLevel;
  DATABASE_URL: string;
}

export interface ApiEnv extends BaseEnv {
  HOST: string;
  PORT: number;
  WEBHOOK_TOKEN: string;
}

export interface WorkerEnv extends BaseEnv {
  ENGINE_TICK_INTERVAL_MS: number;
  RUN_MIGRATIONS: boolean;
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

function resolveDeployEnv(params: { nodeEnv: NodeEnv; deployEnv: DeployEnv | undefined }): DeployEnv {
  if (params.deployEnv) return params.deployEnv;
  return params.nodeEnv === "production" ? "production" : "development";
}

const baseEnvSchema = z
  .object({
    NODE_ENV: nodeEnvSchema,
    DEPLOY_ENV: deployEnvSchema.optional(),
    DATABASE_URL: z.string().min(1),
  });

const baseOverridesEnvSchema = z.object({ LOG_LEVEL: logLevelSchema.optional() });

type ParsedBaseEnv = z.infer<typeof baseEnvSchema>;
type ResolvedBaseEnv = Omit<ParsedBaseEnv, "DEPLOY_ENV"> & { DEPLOY_ENV: DeployEnv };

function loadBaseParts(env: NodeJS.ProcessEnv): { base: ResolvedBaseEnv; yaml: YamlConfig } {
  const base = baseEnvSchema.parse(env);
  const deployEnv = resolveDeployEnv({ nodeEnv: base.NODE_ENV, deployEnv: base.DEPLOY_ENV });
  const yaml = loadYamlConfig({ deployEnv, nodeEnv: base.NODE_ENV });
  return { base: { ...base, DEPLOY_ENV: deployEnv }, yaml };
}

export function loadBaseEnv(env: NodeJS.ProcessEnv = process.env): BaseEnv {
  const { base, yaml } = loadBaseParts(env);
  const overrides = baseOverridesEnvSchema.parse(env);

  return {
    NODE_ENV: base.NODE_ENV,
    DEPLOY_ENV: base.DEPLOY_ENV,
    DATABASE_URL: base.DATABASE_URL,
    LOG_LEVEL: overrides.LOG_LEVEL ?? yaml.logLevel,
  };
}

const apiSecretsEnvSchema = z.object({ WEBHOOK_TOKEN: z.string().min(1) });
const apiOverridesEnvSchema = z
  .object({
    HOST: z.string().min(1).optional(),
    PORT: z.coerce.number().int().positive().optional(),
  })
  .strip();

export function loadApiEnv(env: NodeJS.ProcessEnv = process.env): ApiEnv {
  const { base, yaml } = loadBaseParts(env);
  const baseOverrides = baseOverridesEnvSchema.parse(env);
  const baseEnv: BaseEnv = {
    NODE_ENV: base.NODE_ENV,
    DEPLOY_ENV: base.DEPLOY_ENV,
    DATABASE_URL: base.DATABASE_URL,
    LOG_LEVEL: baseOverrides.LOG_LEVEL ?? yaml.logLevel,
  };

  const secrets = apiSecretsEnvSchema.parse(env);
  const overrides = apiOverridesEnvSchema.parse(env);

  return {
    ...baseEnv,
    HOST: overrides.HOST ?? yaml.api.host,
    PORT: overrides.PORT ?? yaml.api.port,
    WEBHOOK_TOKEN: secrets.WEBHOOK_TOKEN,
  };
}

const optionalBooleanFromString = z
  .string()
  .optional()
  .transform((value) => (value === undefined ? undefined : value.trim().toLowerCase()))
  .refine(
    (value) => value === undefined || value === "true" || value === "false" || value === "1" || value === "0",
    { message: "Expected a boolean string (true/false/1/0)" },
  )
  .transform((value) => (value === undefined ? undefined : value === "true" || value === "1"));

const workerOverridesEnvSchema = z
  .object({
    ENGINE_TICK_INTERVAL_MS: z.coerce.number().int().positive().optional(),
    RUN_MIGRATIONS: optionalBooleanFromString,
  })
  .strip();

export function loadWorkerEnv(env: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const { base, yaml } = loadBaseParts(env);
  const baseOverrides = baseOverridesEnvSchema.parse(env);
  const baseEnv: BaseEnv = {
    NODE_ENV: base.NODE_ENV,
    DEPLOY_ENV: base.DEPLOY_ENV,
    DATABASE_URL: base.DATABASE_URL,
    LOG_LEVEL: baseOverrides.LOG_LEVEL ?? yaml.logLevel,
  };

  const overrides = workerOverridesEnvSchema.parse(env);

  return {
    ...baseEnv,
    ENGINE_TICK_INTERVAL_MS: overrides.ENGINE_TICK_INTERVAL_MS ?? yaml.worker.engineTickIntervalMs,
    RUN_MIGRATIONS: overrides.RUN_MIGRATIONS ?? yaml.worker.runMigrations,
  };
}
