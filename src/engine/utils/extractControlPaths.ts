// src/engine/utils/extractControlPaths.ts
export function extractControlPaths(
  obj: Record<string, any>,
  prefix = ""
): string[] {
  const paths: string[] = [];

  for (const key of Object.keys(obj)) {
    const value = obj[key];
    const path = prefix ? `${prefix}.${key}` : key;

    if (typeof value === "boolean") {
      paths.push(path);
    } else if (typeof value === "object" && value !== null) {
      paths.push(...extractControlPaths(value, path));
    }
  }

  return paths;
}
