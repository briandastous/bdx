import { Buffer } from "node:buffer";
import type { RequestSnapshot, ResponseSnapshot } from "@bdx/twitterapi-io";

export type HttpExchange = {
  request: RequestSnapshot | null;
  response: ResponseSnapshot | null;
};

export const DEFAULT_HTTP_BODY_MAX_BYTES = 2048;

export function resolveHttpBodyMaxBytes(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_HTTP_BODY_MAX_BYTES;
  }
  return Math.floor(value);
}

function truncateBody(body: string, maxBytes: number): string {
  const buffer = Buffer.from(body, "utf8");
  if (buffer.byteLength <= maxBytes) return body;
  return buffer.subarray(0, maxBytes).toString("utf8");
}

export function sanitizeHttpExchange(exchange: HttpExchange, maxBodyBytes: number | undefined): HttpExchange {
  if (!exchange.response) return exchange;
  const limit = resolveHttpBodyMaxBytes(maxBodyBytes);
  const truncatedBody = truncateBody(exchange.response.body, limit);
  if (truncatedBody === exchange.response.body) return exchange;
  return {
    request: exchange.request,
    response: { ...exchange.response, body: truncatedBody },
  };
}
