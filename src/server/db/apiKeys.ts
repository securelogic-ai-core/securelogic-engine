import { db } from "./client";

export function getApiKey(key: string) {
  return db.prepare(
    "SELECT * FROM api_keys WHERE key = ? AND revoked = 0"
  ).get(key);
}
