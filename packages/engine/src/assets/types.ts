import type { AssetSlug, IngestKind } from "@bdx/db";
import type { Logger } from "@bdx/observability";
import type { DbOrTx } from "@bdx/db";
import type { AssetParams } from "./params.js";

export type AssetItemKind = "user" | "post";

export interface DependencySpec {
  name: string;
  assetSlug: AssetSlug;
  params: AssetParams;
}

export interface ResolvedDependency {
  name: string;
  assetSlug: AssetSlug;
  instanceId: bigint;
  params: AssetParams;
  paramsHash: string;
  paramsHashVersion: number;
  materializationId: bigint;
  outputRevision: bigint;
}

export interface IngestRequirement {
  ingestKind: IngestKind;
  targetUserId: bigint;
  freshnessMs: number | null;
  requestedByMaterializationIds?: bigint[];
}

export interface MaterializationContext {
  db: DbOrTx;
  logger: Logger;
  instanceId: bigint;
  assetSlug: AssetSlug;
  params: AssetParams;
  inputsHash: string;
  dependencyRevisionsHash: string;
  dependencies: ResolvedDependency[];
  requestedByMaterializationIds: bigint[];
  triggerReason: string | null;
}
