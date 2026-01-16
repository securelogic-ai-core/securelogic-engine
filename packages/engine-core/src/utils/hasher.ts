import crypto from "crypto";

export function hashObject(obj: unknown): string {
  const json = JSON.stringify(obj, Object.keys(obj as any).sort());
  return crypto.createHash("sha256").update(json).digest("hex");
}