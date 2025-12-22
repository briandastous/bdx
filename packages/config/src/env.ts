import { z } from "zod";

export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  DATABASE_URL: z.string().min(1),
});

const booleanFromString = z
  .enum(["true", "false", "1", "0"])
  .transform((value) => value === "true" || value === "1");

export const apiEnvSchema = baseEnvSchema.extend({
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  WEBHOOK_TOKEN: z.string().min(1),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;

export type BaseEnv = z.infer<typeof baseEnvSchema>;

export function loadBaseEnv(env: NodeJS.ProcessEnv = process.env): BaseEnv {
  return baseEnvSchema.parse(env);
}

export function loadApiEnv(env: NodeJS.ProcessEnv = process.env): ApiEnv {
  return apiEnvSchema.parse(env);
}

export const workerEnvSchema = baseEnvSchema.extend({
  ENGINE_TICK_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  RUN_MIGRATIONS: z
    .string()
    .optional()
    .default("true")
    .transform((value) => value.trim().toLowerCase())
    .pipe(booleanFromString),
});

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function loadWorkerEnv(env: NodeJS.ProcessEnv = process.env): WorkerEnv {
  return workerEnvSchema.parse(env);
}
