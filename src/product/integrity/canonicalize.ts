/**
 * Canonical JSON serializer
 * Ensures deterministic key ordering for hashing
 */
export function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([key, val]) => `"${key}":${canonicalize(val)}`
      );

    return `{${entries.join(",")}}`;
  }

  return JSON.stringify(value);
}
