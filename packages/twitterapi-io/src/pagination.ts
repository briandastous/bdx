import type { JsonObject } from "./types.js";

export function chooseCursor(
  candidates: JsonObject[],
  typedCursor?: string | null,
): string | null {
  if (typedCursor) return typedCursor;

  for (const mapping of candidates) {
    for (const key of ["next_cursor", "nextCursor", "cursor"]) {
      const value = mapping[key];
      if (typeof value === "string" && value.length > 0) return value;
    }
  }

  return null;
}

export function chooseHasNext(
  candidates: JsonObject[],
  typedFlag?: boolean | null,
  fallbackCursor?: string | null,
): boolean {
  if (typedFlag !== undefined && typedFlag !== null) return typedFlag;

  for (const mapping of candidates) {
    for (const key of ["has_next_page", "hasNextPage"]) {
      const value = mapping[key];
      if (typeof value === "boolean") return value;
    }
  }

  return Boolean(fallbackCursor);
}
