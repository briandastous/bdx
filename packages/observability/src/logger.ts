import pino from "pino";
import type { LoggerOptions } from "pino";

export type Logger = pino.Logger;
export type PinoLoggerOptions = LoggerOptions;

export function createPinoOptions(params: {
  env: string;
  level: string;
  service: string;
}): PinoLoggerOptions {
  return {
    level: params.level,
    base: {
      env: params.env,
      service: params.service,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };
}

export function createLogger(params: { env: string; level: string; service: string }): Logger {
  return pino(createPinoOptions(params));
}
