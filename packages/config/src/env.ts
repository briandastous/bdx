import { z } from "zod";

const nodeEnvSchema = z.enum(["development", "test", "production"]).default("development");
const deployEnvSchema = z.enum(["development", "staging", "production"]);

export type NodeEnv = z.infer<typeof nodeEnvSchema>;
export type DeployEnv = z.infer<typeof deployEnvSchema>;

const rawBaseEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  DEPLOY_ENV: deployEnvSchema.optional(),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  DATABASE_URL: z.string().min(1),
});

const booleanFromString = z
  .enum(["true", "false", "1", "0"])
  .transform((value) => value === "true" || value === "1");

export const rawApiEnvSchema = rawBaseEnvSchema.extend({
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  WEBHOOK_TOKEN: z.string().min(1),
});

export type RawApiEnv = z.infer<typeof rawApiEnvSchema>;

export type RawBaseEnv = z.infer<typeof rawBaseEnvSchema>;

export type BaseEnv = Omit<RawBaseEnv, "DEPLOY_ENV"> & { DEPLOY_ENV: DeployEnv };

function resolveDeployEnv(params: {
  nodeEnv: NodeEnv;
  deployEnv: DeployEnv | undefined;
}): DeployEnv {
  if (params.deployEnv) return params.deployEnv;
  return params.nodeEnv === "production" ? "production" : "development";
}

export function loadBaseEnv(env: NodeJS.ProcessEnv = process.env): BaseEnv {
  const parsed = rawBaseEnvSchema.parse(env);
  return {
    ...parsed,
    DEPLOY_ENV: resolveDeployEnv({
      nodeEnv: parsed.NODE_ENV,
      deployEnv: parsed.DEPLOY_ENV,
    }),
  };
}

export type ApiEnv = Omit<RawApiEnv, "DEPLOY_ENV"> & { DEPLOY_ENV: DeployEnv };

export function loadApiEnv(env: NodeJS.ProcessEnv = process.env): ApiEnv {
  const parsed = rawApiEnvSchema.parse(env);
  return {
    ...parsed,
    DEPLOY_ENV: resolveDeployEnv({
      nodeEnv: parsed.NODE_ENV,
      deployEnv: parsed.DEPLOY_ENV,
    }),
  };
}

export const rawWorkerEnvSchema = rawBaseEnvSchema.extend({
  ENGINE_TICK_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  RUN_MIGRATIONS: z
    .string()
    .optional()
    .default("true")
    .transform((value) => value.trim().toLowerCase())
    .pipe(booleanFromString),
});

export type RawWorkerEnv = z.infer<typeof rawWorkerEnvSchema>;

export type WorkerEnv = Omit<RawWorkerEnv, "DEPLOY_ENV"> & { DEPLOY_ENV: DeployEnv };

export function loadWorkerEnv(env: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const parsed = rawWorkerEnvSchema.parse(env);
  return {
    ...parsed,
    DEPLOY_ENV: resolveDeployEnv({
      nodeEnv: parsed.NODE_ENV,
      deployEnv: parsed.DEPLOY_ENV,
    }),
  };
}
