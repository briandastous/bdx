import type { Db, JsonValue } from "@bdx/db";
import {
  getAssetMaterializationById,
  getFollowersSyncRunById,
  getFollowingsSyncRunById,
  getPostsSyncRunById,
  listEnabledAssetInstanceFanoutRootsWithDetails,
  listEnabledAssetInstanceRootsWithDetails,
} from "@bdx/db";
import type { UserId } from "@bdx/ids";
import { parseAssetMaterializationId, parseIngestEventId } from "@bdx/ids";
import type { PinoLoggerOptions } from "@bdx/observability";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
  extendZodWithOpenApi,
} from "@asteasolutions/zod-to-openapi";
import {
  TwitterApiRateLimitError,
  TwitterApiRequestError,
  TwitterApiTransportError,
  TwitterApiUnexpectedResponseError,
  type TwitterApiClient,
  type XUserData,
} from "@bdx/twitterapi-io";
import { ingestIftttNewFollower } from "./services/ifttt.js";

extendZodWithOpenApi(z);

const jsonValueSchema: z.ZodType<JsonValue> = z
  .lazy(() =>
    z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.null(),
      z.array(jsonValueSchema),
      z.record(jsonValueSchema),
    ]),
  )
  .openapi({
    type: "object",
    additionalProperties: true,
  });

const idSchema = z.string().regex(/^\d+$/).openapi({ format: "int64" });
const idParamSchema = z.object({ id: z.string().regex(/^\d+$/) });
const ingestKindSchema = z.enum([
  "twitterio_api_user_followers",
  "twitterio_api_user_followings",
  "twitterio_api_users_posts",
  "ifttt_webhook_new_follow",
]);
const syncRunStatusSchema = z.enum(["success", "in_progress", "cancelled", "error"]);
const followsSyncModeSchema = z.enum(["full_refresh", "incremental"]);
const assetSlugSchema = z.enum([
  "segment_specified_users",
  "segment_followers",
  "segment_followed",
  "segment_mutuals",
  "segment_unreciprocated_followed",
  "post_corpus_for_segment",
]);
const assetMaterializationStatusSchema = z.enum(["success", "in_progress", "cancelled", "error"]);
const assetFanoutModeSchema = z.enum(["global_per_item", "scoped_by_source"]);

const webhookQuerySchema = z.object({
  token: z.string().min(1),
});

const webhookPayloadSchema = z
  .object({
    LinkToProfile: z
      .string()
      .min(1)
      .openapi({ description: "Profile URL emitted by the upstream integration." }),
  })
  .catchall(jsonValueSchema);

const webhookResponseSchema = z.object({
  status: z.string(),
  message: z.string(),
  handle: z.string(),
  follower_user_id: idSchema.nullable(),
  ingest_event_id: idSchema.nullable(),
  ingest_kind: ingestKindSchema.nullable(),
  target_user_id: idSchema.nullable(),
});

const errorResponseSchema = z.object({
  error: z.string(),
});

const followersRunSchema = z.object({
  ingest_event_id: idSchema,
  ingest_kind: ingestKindSchema,
  created_at: z.string().datetime(),
  target_user_id: idSchema,
  status: syncRunStatusSchema,
  sync_mode: followsSyncModeSchema,
  completed_at: z.string().datetime().nullable(),
  cursor_exhausted: z.boolean(),
  last_api_status: z.string().nullable(),
  last_api_error: z.string().nullable(),
  last_http_request: jsonValueSchema.nullable(),
  last_http_response: jsonValueSchema.nullable(),
});

const followingsRunSchema = z.object({
  ingest_event_id: idSchema,
  ingest_kind: ingestKindSchema,
  created_at: z.string().datetime(),
  source_user_id: idSchema,
  status: syncRunStatusSchema,
  sync_mode: followsSyncModeSchema,
  completed_at: z.string().datetime().nullable(),
  cursor_exhausted: z.boolean(),
  last_api_status: z.string().nullable(),
  last_api_error: z.string().nullable(),
  last_http_request: jsonValueSchema.nullable(),
  last_http_response: jsonValueSchema.nullable(),
});

const postsRunSchema = z.object({
  ingest_event_id: idSchema,
  ingest_kind: ingestKindSchema,
  created_at: z.string().datetime(),
  status: syncRunStatusSchema,
  completed_at: z.string().datetime().nullable(),
  cursor_exhausted: z.boolean(),
  synced_since: z.string().datetime().nullable(),
  last_api_status: z.string().nullable(),
  last_api_error: z.string().nullable(),
  last_http_request: jsonValueSchema.nullable(),
  last_http_response: jsonValueSchema.nullable(),
  target_user_ids: z.array(idSchema),
});

const materializationSchema = z.object({
  id: idSchema,
  asset_instance_id: idSchema,
  asset_slug: assetSlugSchema,
  inputs_hash_version: z.number().int(),
  inputs_hash: z.string(),
  dependency_revisions_hash_version: z.number().int(),
  dependency_revisions_hash: z.string(),
  output_revision: idSchema,
  status: assetMaterializationStatusSchema,
  started_at: z.string().datetime(),
  completed_at: z.string().datetime().nullable(),
  trigger_reason: z.string().nullable(),
  error_payload: jsonValueSchema.nullable(),
  dependency_materialization_ids: z.array(idSchema),
  requested_by_materialization_ids: z.array(idSchema),
});

const rootsResponseSchema = z.object({
  roots: z.array(
    z.object({
      id: idSchema,
      instance_id: idSchema,
      asset_slug: assetSlugSchema,
      params_hash_version: z.number().int(),
      params_hash: z.string(),
      created_at: z.string().datetime(),
      disabled_at: z.string().datetime().nullable(),
    }),
  ),
  fanout_roots: z.array(
    z.object({
      id: idSchema,
      source_instance_id: idSchema,
      source_asset_slug: assetSlugSchema,
      source_params_hash_version: z.number().int(),
      source_params_hash: z.string(),
      target_asset_slug: assetSlugSchema,
      fanout_mode: assetFanoutModeSchema,
      created_at: z.string().datetime(),
      disabled_at: z.string().datetime().nullable(),
    }),
  ),
});

function parseIdParam<T>(params: unknown, parser: (value: string) => T): T {
  const parsed = idParamSchema.parse(params);
  return parser(parsed.id);
}

function toIsoString(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function extractHandleFromProfileLink(link: string): string | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }

  const path = url.pathname.replace(/^\/+|\/+$/g, "");
  if (!path) return null;

  const [handle] = path.split("/", 1);
  if (!handle) return null;
  return handle.length > 0 ? handle : null;
}

export function buildServer(params: {
  db: Db;
  loggerOptions: PinoLoggerOptions;
  webhookToken: string;
  twitterClient: TwitterApiClient;
  xSelf: { userId: UserId; handle: string };
}): FastifyInstance {
  const server = Fastify({
    logger: params.loggerOptions,
  });

  const registry = new OpenAPIRegistry();

  registry.registerPath({
    method: "get",
    path: "/healthz",
    responses: {
      200: {
        description: "Health check",
        content: { "application/json": { schema: z.object({ ok: z.boolean() }) } },
      },
    },
  });

  registry.registerPath({
    method: "post",
    path: "/webhooks/ifttt/new-x-follower",
    request: {
      query: webhookQuerySchema,
      body: {
        content: { "application/json": { schema: webhookPayloadSchema } },
      },
    },
    responses: {
      200: {
        description: "Webhook accepted",
        content: { "application/json": { schema: webhookResponseSchema } },
      },
      400: {
        description: "Invalid payload",
        content: { "application/json": { schema: errorResponseSchema } },
      },
      401: {
        description: "Unauthorized",
        content: { "application/json": { schema: errorResponseSchema } },
      },
      404: {
        description: "Follower profile not found",
        content: { "application/json": { schema: errorResponseSchema } },
      },
      422: {
        description: "Follower profile invalid",
        content: { "application/json": { schema: errorResponseSchema } },
      },
      502: {
        description: "Upstream request failed",
        content: { "application/json": { schema: errorResponseSchema } },
      },
      503: {
        description: "Upstream rate limited",
        content: { "application/json": { schema: errorResponseSchema } },
      },
    },
  });

  registry.registerPath({
    method: "get",
    path: "/v1/ingest/followers/{id}",
    request: { params: z.object({ id: idSchema }) },
    responses: {
      200: {
        description: "Followers sync run",
        content: { "application/json": { schema: followersRunSchema } },
      },
      404: {
        description: "Not found",
        content: { "application/json": { schema: errorResponseSchema } },
      },
    },
  });

  registry.registerPath({
    method: "get",
    path: "/v1/ingest/followings/{id}",
    request: { params: z.object({ id: idSchema }) },
    responses: {
      200: {
        description: "Followings sync run",
        content: { "application/json": { schema: followingsRunSchema } },
      },
      404: {
        description: "Not found",
        content: { "application/json": { schema: errorResponseSchema } },
      },
    },
  });

  registry.registerPath({
    method: "get",
    path: "/v1/ingest/posts/{id}",
    request: { params: z.object({ id: idSchema }) },
    responses: {
      200: {
        description: "Posts sync run",
        content: { "application/json": { schema: postsRunSchema } },
      },
      404: {
        description: "Not found",
        content: { "application/json": { schema: errorResponseSchema } },
      },
    },
  });

  registry.registerPath({
    method: "get",
    path: "/v1/materializations/{id}",
    request: { params: z.object({ id: idSchema }) },
    responses: {
      200: {
        description: "Asset materialization",
        content: { "application/json": { schema: materializationSchema } },
      },
      404: {
        description: "Not found",
        content: { "application/json": { schema: errorResponseSchema } },
      },
    },
  });

  registry.registerPath({
    method: "get",
    path: "/v1/roots",
    responses: {
      200: {
        description: "Enabled roots",
        content: { "application/json": { schema: rootsResponseSchema } },
      },
    },
  });

  const openApiDocument = new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: "3.0.3",
    info: { title: "bdx api", version: "0.1.0" },
  });

  server.get("/healthz", () => ({ ok: true }));

  server.get("/openapi.json", (_request, reply) => {
    return reply.status(200).send(openApiDocument);
  });

  server.post("/webhooks/ifttt/new-x-follower", async (request, reply) => {
    const queryResult = webhookQuerySchema.safeParse(request.query);
    if (!queryResult.success || queryResult.data.token !== params.webhookToken) {
      return reply.status(401).send({ error: "unauthorized" });
    }

    const payloadResult = webhookPayloadSchema.safeParse(request.body);
    if (!payloadResult.success) {
      return reply.status(400).send({ error: "invalid body" });
    }

    const link = payloadResult.data.LinkToProfile;
    const handle = extractHandleFromProfileLink(link);
    if (!handle) {
      return reply
        .status(400)
        .send({ error: "Unable to derive follower handle from LinkToProfile." });
    }

    request.log.info({ handle }, "Received ifttt_new_x_follower webhook");

    let profile: XUserData | null;
    try {
      profile = await params.twitterClient.fetchUserProfileByHandle(handle);
    } catch (error) {
      if (error instanceof TwitterApiRateLimitError) {
        const retryAfter = Math.trunc(error.retryAfterSeconds ?? 60);
        return reply
          .status(503)
          .headers({ "Retry-After": String(retryAfter) })
          .send({ error: "Upstream rate limited" });
      }
      if (
        error instanceof TwitterApiRequestError ||
        error instanceof TwitterApiUnexpectedResponseError ||
        error instanceof TwitterApiTransportError
      ) {
        return reply.status(502).send({ error: "Upstream request failed" });
      }
      request.log.error({ error }, "Unexpected twitterapi.io error");
      return reply.status(500).send({ error: "Internal server error" });
    }

    if (!profile) {
      return reply.status(404).send({ error: `Follower profile not found for handle '${handle}'` });
    }

    if (profile.userId === null) {
      return reply.status(422).send({ error: "Follower profile missing user id" });
    }

    if (!profile.userName) {
      return reply.status(422).send({ error: "Follower profile missing handle" });
    }

    try {
      const result = await ingestIftttNewFollower({
        db: params.db,
        targetUserId: params.xSelf.userId,
        targetUserHandle: params.xSelf.handle,
        followerHandle: handle,
        followerProfile: profile,
        rawPayload: payloadResult.data,
      });

      request.log.info(
        {
          ingestEventId: result.ingestEventId.toString(),
          followerUserId: result.followerUserId.toString(),
        },
        "Persisted follower from webhook",
      );

      return await reply.status(200).headers({ "Cache-Control": "no-store" }).send({
        status: "ok",
        message: "Webhook received successfully",
        handle: result.followerHandle,
        follower_user_id: result.followerUserId.toString(),
        ingest_event_id: result.ingestEventId.toString(),
        ingest_kind: result.ingestKind,
        target_user_id: result.targetUserId.toString(),
      });
    } catch (error) {
      request.log.error({ error }, "Failed to ingest webhook follow event");
      return reply.status(500).send({ error: "Internal server error" });
    }
  });

  server.get("/v1/ingest/followers/:id", async (request, reply) => {
    const ingestEventId = parseIdParam(request.params, parseIngestEventId);
    const record = await getFollowersSyncRunById(params.db, ingestEventId);
    if (!record) {
      return reply.status(404).send({ error: "not_found" });
    }

    return reply.status(200).send({
      ingest_event_id: record.ingestEventId.toString(),
      ingest_kind: record.ingestKind,
      created_at: record.createdAt.toISOString(),
      target_user_id: record.targetUserId.toString(),
      status: record.status,
      sync_mode: record.syncMode,
      completed_at: toIsoString(record.completedAt),
      cursor_exhausted: record.cursorExhausted,
      last_api_status: record.lastApiStatus,
      last_api_error: record.lastApiError,
      last_http_request: record.lastHttpRequest,
      last_http_response: record.lastHttpResponse,
    });
  });

  server.get("/v1/ingest/followings/:id", async (request, reply) => {
    const ingestEventId = parseIdParam(request.params, parseIngestEventId);
    const record = await getFollowingsSyncRunById(params.db, ingestEventId);
    if (!record) {
      return reply.status(404).send({ error: "not_found" });
    }

    return reply.status(200).send({
      ingest_event_id: record.ingestEventId.toString(),
      ingest_kind: record.ingestKind,
      created_at: record.createdAt.toISOString(),
      source_user_id: record.sourceUserId.toString(),
      status: record.status,
      sync_mode: record.syncMode,
      completed_at: toIsoString(record.completedAt),
      cursor_exhausted: record.cursorExhausted,
      last_api_status: record.lastApiStatus,
      last_api_error: record.lastApiError,
      last_http_request: record.lastHttpRequest,
      last_http_response: record.lastHttpResponse,
    });
  });

  server.get("/v1/ingest/posts/:id", async (request, reply) => {
    const ingestEventId = parseIdParam(request.params, parseIngestEventId);
    const record = await getPostsSyncRunById(params.db, ingestEventId);
    if (!record) {
      return reply.status(404).send({ error: "not_found" });
    }

    return reply.status(200).send({
      ingest_event_id: record.ingestEventId.toString(),
      ingest_kind: record.ingestKind,
      created_at: record.createdAt.toISOString(),
      status: record.status,
      completed_at: toIsoString(record.completedAt),
      cursor_exhausted: record.cursorExhausted,
      synced_since: toIsoString(record.syncedSince),
      last_api_status: record.lastApiStatus,
      last_api_error: record.lastApiError,
      last_http_request: record.lastHttpRequest,
      last_http_response: record.lastHttpResponse,
      target_user_ids: record.targetUserIds.map((id) => id.toString()),
    });
  });

  server.get("/v1/materializations/:id", async (request, reply) => {
    const materializationId = parseIdParam(request.params, parseAssetMaterializationId);
    const record = await getAssetMaterializationById(params.db, materializationId);
    if (!record) {
      return reply.status(404).send({ error: "not_found" });
    }

    return reply.status(200).send({
      id: record.id.toString(),
      asset_instance_id: record.assetInstanceId.toString(),
      asset_slug: record.assetSlug,
      inputs_hash_version: record.inputsHashVersion,
      inputs_hash: record.inputsHash,
      dependency_revisions_hash_version: record.dependencyRevisionsHashVersion,
      dependency_revisions_hash: record.dependencyRevisionsHash,
      output_revision: record.outputRevision.toString(),
      status: record.status,
      started_at: record.startedAt.toISOString(),
      completed_at: toIsoString(record.completedAt),
      trigger_reason: record.triggerReason,
      error_payload: record.errorPayload,
      dependency_materialization_ids: record.dependencyMaterializationIds.map((id) =>
        id.toString(),
      ),
      requested_by_materialization_ids: record.requestedByMaterializationIds.map((id) =>
        id.toString(),
      ),
    });
  });

  server.get("/v1/roots", async (_request, reply) => {
    const [roots, fanoutRoots] = await Promise.all([
      listEnabledAssetInstanceRootsWithDetails(params.db),
      listEnabledAssetInstanceFanoutRootsWithDetails(params.db),
    ]);

    return reply.status(200).send({
      roots: roots.map((root) => ({
        id: root.id.toString(),
        instance_id: root.instanceId.toString(),
        asset_slug: root.assetSlug,
        params_hash_version: root.paramsHashVersion,
        params_hash: root.paramsHash,
        created_at: root.createdAt.toISOString(),
        disabled_at: toIsoString(root.disabledAt),
      })),
      fanout_roots: fanoutRoots.map((root) => ({
        id: root.id.toString(),
        source_instance_id: root.sourceInstanceId.toString(),
        source_asset_slug: root.sourceAssetSlug,
        source_params_hash_version: root.sourceParamsHashVersion,
        source_params_hash: root.sourceParamsHash,
        target_asset_slug: root.targetAssetSlug,
        fanout_mode: root.fanoutMode,
        created_at: root.createdAt.toISOString(),
        disabled_at: toIsoString(root.disabledAt),
      })),
    });
  });

  return server;
}
