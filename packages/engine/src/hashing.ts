import { createHash } from "node:crypto";

export const HASH_VERSION_V1 = 1 as const;
export type HashVersion = typeof HASH_VERSION_V1;

export function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hashPartsV1(parts: readonly string[]): { version: HashVersion; hash: string } {
  const hasher = createHash("sha256");
  hasher.update("v1\0");
  for (const part of parts) {
    hasher.update(part);
    hasher.update("\0");
  }
  return { version: HASH_VERSION_V1, hash: hasher.digest("hex") };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Reflect.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function stableJsonStringify(value: unknown): string {
  return stableSerialize(value, "$");
}

function stableSerialize(value: unknown, atPath: string): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "number": {
      if (!Number.isFinite(value))
        throw new Error(`Non-finite number not allowed in hash input at ${atPath}`);
      return JSON.stringify(value);
    }
    case "boolean":
      return value ? "true" : "false";
    case "function":
      throw new Error(`function not allowed in hash input at ${atPath}`);
    case "symbol":
      throw new Error(`symbol not allowed in hash input at ${atPath}`);
    case "undefined":
      throw new Error(`undefined not allowed in hash input at ${atPath}`);
    case "bigint":
      throw new Error(
        `bigint not allowed in hash input at ${atPath}; convert to a decimal string first`,
      );
    case "object": {
      if (Array.isArray(value)) {
        const serialized = value.map((item, index) => {
          if (item === undefined) {
            throw new Error(`undefined not allowed in array hash input at ${atPath}[${index}]`);
          }
          return stableSerialize(item, `${atPath}[${index}]`);
        });
        return `[${serialized.join(",")}]`;
      }

      if (!isPlainObject(value)) {
        throw new Error(`Only plain objects are allowed in hash input at ${atPath}`);
      }

      const keys = Object.keys(value).sort();
      const serialized: string[] = [];
      for (const key of keys) {
        const itemPath = `${atPath}.${key}`;
        const item = value[key];
        if (item === undefined) continue;
        serialized.push(`${JSON.stringify(key)}:${stableSerialize(item, itemPath)}`);
      }
      return `{${serialized.join(",")}}`;
    }
    default:
      throw new Error(`Unsupported value type in hash input at ${atPath}`);
  }
}

export function hashJsonV1(value: unknown): { version: HashVersion; hash: string } {
  return { version: HASH_VERSION_V1, hash: sha256Hex(stableJsonStringify(value)) };
}
