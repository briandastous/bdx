import type { Db } from "@bdx/db";
import type { PinoLoggerOptions } from "@bdx/observability";
import Fastify from "fastify";
import { z } from "zod";

const webhookBodySchema = z.object({
  handle: z.string().min(1),
});

export function buildServer(params: {
  db: Db;
  loggerOptions: PinoLoggerOptions;
  webhookToken: string;
}) {
  const server = Fastify({
    logger: params.loggerOptions,
  });

  server.get("/healthz", () => ({ ok: true }));

  server.post("/webhooks/ifttt/new-x-follower", (request, reply) => {
    const token =
      typeof request.query === "object" && request.query !== null && "token" in request.query
        ? (request.query as { token?: unknown }).token
        : undefined;

    if (token !== params.webhookToken) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    const parsed = webhookBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "invalid body" });
    }

    return reply.status(200).send({ ok: true, handle: parsed.data.handle });
  });

  return server;
}
