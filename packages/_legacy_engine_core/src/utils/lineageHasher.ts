import { createHash } from "crypto";

export function hashLineage(obj: unknown): string {
  const json = JSON.stringify(obj, Object.keys(obj as any).sort());
  return createHash("sha256").update(json).digest("hex");
}
