import type {
  AssetInstanceFanoutRootId,
  AssetInstanceId,
  AssetInstanceRootId,
  AssetMaterializationId,
  PostId,
  UserId,
} from "@bdx/ids";
import {
  AssetInstanceFanoutRootId as AssetInstanceFanoutRootIdBrand,
  AssetInstanceId as AssetInstanceIdBrand,
  AssetInstanceRootId as AssetInstanceRootIdBrand,
  AssetMaterializationId as AssetMaterializationIdBrand,
  PostId as PostIdBrand,
  UserId as UserIdBrand,
} from "@bdx/ids";

export function parseBigInt(value: string, label: string): bigint {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${label} must not be empty`);
  }
  if (!/^-?\d+$/.test(trimmed)) {
    throw new Error(`${label} must be an integer`);
  }
  return BigInt(trimmed);
}

export function parsePositiveBigInt(value: string, label: string): bigint {
  const parsed = parseBigInt(value, label);
  if (parsed <= 0n) {
    throw new Error(`${label} must be positive`);
  }
  return parsed;
}

export function parseBigIntCsv(value: string, label: string): bigint[] {
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) {
    throw new Error(`${label} must contain at least one id`);
  }
  return parts.map((part, index) => parsePositiveBigInt(part, `${label}[${index}]`));
}

export function parseUserId(value: string, label: string): UserId {
  return UserIdBrand(parsePositiveBigInt(value, label));
}

export function parseUserIdCsv(value: string, label: string): UserId[] {
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) {
    throw new Error(`${label} must contain at least one id`);
  }
  return parts.map((part, index) => parseUserId(part, `${label}[${index}]`));
}

export function parsePostId(value: string, label: string): PostId {
  return PostIdBrand(parsePositiveBigInt(value, label));
}

export function parsePostIdCsv(value: string, label: string): PostId[] {
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length === 0) {
    throw new Error(`${label} must contain at least one id`);
  }
  return parts.map((part, index) => parsePostId(part, `${label}[${index}]`));
}

export function parseAssetInstanceId(value: string, label: string): AssetInstanceId {
  return AssetInstanceIdBrand(parsePositiveBigInt(value, label));
}

export function parseAssetInstanceRootId(value: string, label: string): AssetInstanceRootId {
  return AssetInstanceRootIdBrand(parsePositiveBigInt(value, label));
}

export function parseAssetInstanceFanoutRootId(
  value: string,
  label: string,
): AssetInstanceFanoutRootId {
  return AssetInstanceFanoutRootIdBrand(parsePositiveBigInt(value, label));
}

export function parseAssetMaterializationId(value: string, label: string): AssetMaterializationId {
  return AssetMaterializationIdBrand(parsePositiveBigInt(value, label));
}

export function parseDate(value: string, label: string): Date {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error(`${label} must be a valid date`);
  }
  return parsed;
}

export function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch (error) {
    throw new Error(`${label} must be valid JSON`, { cause: error });
  }
}
