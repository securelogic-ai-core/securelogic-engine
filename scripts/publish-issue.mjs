import fs from "fs";
import path from "path";
import { createClient } from "redis";

const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL) throw new Error("REDIS_URL missing");

const id = Number(process.argv[2] ?? "1");
if (!Number.isFinite(id) || id <= 0) {
  throw new Error("Usage: node scripts/publish-issue.mjs <issueId>");
}

const filePath = path.resolve(`data/issues/issue-${id}.json`);

if (!fs.existsSync(filePath)) {
  throw new Error(`Issue artifact not found: ${filePath}`);
}

const artifactJson = fs.readFileSync(filePath, "utf-8");

const KEY_LATEST = "issues:latest";
const KEY_PREFIX = "issues:artifact:";

const redis = createClient({ url: REDIS_URL });

redis.on("error", (err) => console.error("Redis error:", err));

await redis.connect();

await redis.set(`${KEY_PREFIX}${id}`, artifactJson);
await redis.set(KEY_LATEST, String(id));

console.log(`✅ Published issue ${id} to Redis`);
console.log(`- ${KEY_LATEST} = ${id}`);
console.log(`- ${KEY_PREFIX}${id} = <artifact json>`);

await redis.quit();
