import type { AssetSlug, IngestKind } from "@bdx/db";
import type { Logger } from "@bdx/observability";
import type { DbOrTx } from "@bdx/db";
import type { AssetInstanceId, AssetMaterializationId, PostId, UserId } from "@bdx/ids";
import type { AssetParams } from "./params.js";

export type AssetItemKind = "user" | "post";
export type AssetItemId = UserId | PostId;

export type Awaitable<T> = T | Promise<T>;

export interface DependencySpec {
  name: string;
  assetSlug: AssetSlug;
  params: AssetParams;
}

export interface ResolvedDependency {
  name: string;
  assetSlug: AssetSlug;
  instanceId: AssetInstanceId;
  params: AssetParams;
  paramsHash: string;
  paramsHashVersion: number;
  materializationId: AssetMaterializationId;
  outputRevision: bigint;
}

export interface IngestRequirement {
  ingestKind: IngestKind;
  targetUserId: UserId;
  freshnessMs: number | null;
  requestedByMaterializationIds?: AssetMaterializationId[];
}

export interface MaterializationContext {
  db: DbOrTx;
  logger: Logger;
  instanceId: AssetInstanceId;
  assetSlug: AssetSlug;
  params: AssetParams;
  inputsHash: string;
  dependencyRevisionsHash: string;
  dependencies: ResolvedDependency[];
  requestedByMaterializationIds: AssetMaterializationId[];
  triggerReason: string | null;
}
