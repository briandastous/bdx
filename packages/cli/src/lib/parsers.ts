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
