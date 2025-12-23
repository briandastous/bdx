declare const brandSymbol: unique symbol;

export type Brand<T, B extends string> = T & { readonly [brandSymbol]: B };

function asBrand<T, B extends string>(value: T): Brand<T, B> {
  return value as Brand<T, B>;
}

export function parseBigIntId(value: string, label: string): bigint {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${label} must be a non-empty bigint`);
  }
  try {
    return BigInt(trimmed);
  } catch {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}

export function parseStringId(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return trimmed;
}

export type IngestEventId = Brand<bigint, "IngestEventId">;
export function IngestEventId(value: bigint): IngestEventId {
  return asBrand(value);
}
export function parseIngestEventId(value: string): IngestEventId {
  return IngestEventId(parseBigIntId(value, "IngestEventId"));
}

export type UserId = Brand<bigint, "UserId">;
export function UserId(value: bigint): UserId {
  return asBrand(value);
}
export function parseUserId(value: string): UserId {
  return UserId(parseBigIntId(value, "UserId"));
}

export type PostId = Brand<bigint, "PostId">;
export function PostId(value: bigint): PostId {
  return asBrand(value);
}
export function parsePostId(value: string): PostId {
  return PostId(parseBigIntId(value, "PostId"));
}

export type UsersMetaId = Brand<bigint, "UsersMetaId">;
export function UsersMetaId(value: bigint): UsersMetaId {
  return asBrand(value);
}
export function parseUsersMetaId(value: string): UsersMetaId {
  return UsersMetaId(parseBigIntId(value, "UsersMetaId"));
}

export type FollowsMetaId = Brand<bigint, "FollowsMetaId">;
export function FollowsMetaId(value: bigint): FollowsMetaId {
  return asBrand(value);
}
export function parseFollowsMetaId(value: string): FollowsMetaId {
  return FollowsMetaId(parseBigIntId(value, "FollowsMetaId"));
}

export type PostsMetaId = Brand<bigint, "PostsMetaId">;
export function PostsMetaId(value: bigint): PostsMetaId {
  return asBrand(value);
}
export function parsePostsMetaId(value: string): PostsMetaId {
  return PostsMetaId(parseBigIntId(value, "PostsMetaId"));
}

export type UserHandleHistoryId = Brand<bigint, "UserHandleHistoryId">;
export function UserHandleHistoryId(value: bigint): UserHandleHistoryId {
  return asBrand(value);
}
export function parseUserHandleHistoryId(value: string): UserHandleHistoryId {
  return UserHandleHistoryId(parseBigIntId(value, "UserHandleHistoryId"));
}

export type SchedulerPolicyOverrideId = Brand<bigint, "SchedulerPolicyOverrideId">;
export function SchedulerPolicyOverrideId(value: bigint): SchedulerPolicyOverrideId {
  return asBrand(value);
}
export function parseSchedulerPolicyOverrideId(value: string): SchedulerPolicyOverrideId {
  return SchedulerPolicyOverrideId(parseBigIntId(value, "SchedulerPolicyOverrideId"));
}

export type SchedulerPlannerEventId = Brand<bigint, "SchedulerPlannerEventId">;
export function SchedulerPlannerEventId(value: bigint): SchedulerPlannerEventId {
  return asBrand(value);
}
export function parseSchedulerPlannerEventId(value: string): SchedulerPlannerEventId {
  return SchedulerPlannerEventId(parseBigIntId(value, "SchedulerPlannerEventId"));
}

export type AssetParamsId = Brand<bigint, "AssetParamsId">;
export function AssetParamsId(value: bigint): AssetParamsId {
  return asBrand(value);
}
export function parseAssetParamsId(value: string): AssetParamsId {
  return AssetParamsId(parseBigIntId(value, "AssetParamsId"));
}

export type AssetInstanceId = Brand<bigint, "AssetInstanceId">;
export function AssetInstanceId(value: bigint): AssetInstanceId {
  return asBrand(value);
}
export function parseAssetInstanceId(value: string): AssetInstanceId {
  return AssetInstanceId(parseBigIntId(value, "AssetInstanceId"));
}

export type AssetInstanceRootId = Brand<bigint, "AssetInstanceRootId">;
export function AssetInstanceRootId(value: bigint): AssetInstanceRootId {
  return asBrand(value);
}
export function parseAssetInstanceRootId(value: string): AssetInstanceRootId {
  return AssetInstanceRootId(parseBigIntId(value, "AssetInstanceRootId"));
}

export type AssetInstanceFanoutRootId = Brand<bigint, "AssetInstanceFanoutRootId">;
export function AssetInstanceFanoutRootId(value: bigint): AssetInstanceFanoutRootId {
  return asBrand(value);
}
export function parseAssetInstanceFanoutRootId(value: string): AssetInstanceFanoutRootId {
  return AssetInstanceFanoutRootId(parseBigIntId(value, "AssetInstanceFanoutRootId"));
}

export type AssetMaterializationId = Brand<bigint, "AssetMaterializationId">;
export function AssetMaterializationId(value: bigint): AssetMaterializationId {
  return asBrand(value);
}
export function parseAssetMaterializationId(value: string): AssetMaterializationId {
  return AssetMaterializationId(parseBigIntId(value, "AssetMaterializationId"));
}

export type SegmentEventId = Brand<bigint, "SegmentEventId">;
export function SegmentEventId(value: bigint): SegmentEventId {
  return asBrand(value);
}
export function parseSegmentEventId(value: string): SegmentEventId {
  return SegmentEventId(parseBigIntId(value, "SegmentEventId"));
}

export type PostCorpusEventId = Brand<bigint, "PostCorpusEventId">;
export function PostCorpusEventId(value: bigint): PostCorpusEventId {
  return asBrand(value);
}
export function parsePostCorpusEventId(value: string): PostCorpusEventId {
  return PostCorpusEventId(parseBigIntId(value, "PostCorpusEventId"));
}

export type SchedulerJobId = Brand<string, "SchedulerJobId">;
export function SchedulerJobId(value: string): SchedulerJobId {
  return asBrand(value);
}
export function parseSchedulerJobId(value: string): SchedulerJobId {
  return SchedulerJobId(parseStringId(value, "SchedulerJobId"));
}

export type SchedulerTargetId = Brand<string, "SchedulerTargetId">;
export function SchedulerTargetId(value: string): SchedulerTargetId {
  return asBrand(value);
}
export function parseSchedulerTargetId(value: string): SchedulerTargetId {
  return SchedulerTargetId(parseStringId(value, "SchedulerTargetId"));
}

export type PlannerRunId = Brand<string, "PlannerRunId">;
export function PlannerRunId(value: string): PlannerRunId {
  return asBrand(value);
}
export function parsePlannerRunId(value: string): PlannerRunId {
  return PlannerRunId(parseStringId(value, "PlannerRunId"));
}

export type WorkerServiceName = Brand<string, "WorkerServiceName">;
export function WorkerServiceName(value: string): WorkerServiceName {
  return asBrand(value);
}
export function parseWorkerServiceName(value: string): WorkerServiceName {
  return WorkerServiceName(parseStringId(value, "WorkerServiceName"));
}

export type WorkerId = Brand<string, "WorkerId">;
export function WorkerId(value: string): WorkerId {
  return asBrand(value);
}
export function parseWorkerId(value: string): WorkerId {
  return WorkerId(parseStringId(value, "WorkerId"));
}
