export function canonicalize(input: unknown): string {
  if (input === null || typeof input !== "object") {
    return JSON.stringify(input);
  }

  if (Array.isArray(input)) {
    return `[${input.map(canonicalize).join(",")}]`;
  }

  const obj = input as Record<string, unknown>;
  const keys = Object.keys(obj).sort();

  return `{${keys.map(k => `"${k}":${canonicalize(obj[k])}`).join(",")}}`;
}
