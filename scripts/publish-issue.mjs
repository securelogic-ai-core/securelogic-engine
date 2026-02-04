import fs from "fs";
import path from "path";
import { createClient } from "redis";

const REDIS_URL = process.env.REDIS_URL;
if (!REDIS_URL) throw new Error("REDIS_URL missing");

const args = process.argv.slice(2);

const useStdin = args.includes("--stdin");
const idArg = args.find((a) => /^\d+$/.test(a));
const issueId = idArg ? Number(idArg) : null;

const client = createClient({ url: REDIS_URL });

await client.connect();

const readStdin = async () => {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");

    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
};

let artifactRaw = null;
let resolvedIssueId = issueId;

if (useStdin) {
  artifactRaw = await readStdin();

  if (!artifactRaw || artifactRaw.trim().length === 0) {
    throw new Error("No stdin data received");
  }

  // try to extract issueNumber from stdin artifact
  try {
    const parsed = JSON.parse(artifactRaw);
    const n = parsed?.issue?.issueNumber;

    if (typeof n === "number" && Number.isFinite(n) && n > 0) {
      resolvedIssueId = n;
    }
  } catch {
    // ignore, we’ll validate later
  }
} else {
  if (!issueId) {
    throw new Error("Usage: node scripts/publish-issue.mjs <issueNumber> OR --stdin");
  }

  const filePath = path.resolve("data/issues", `issue-${issueId}.json`);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Issue artifact not found: ${filePath}`);
  }

  artifactRaw = fs.readFileSync(filePath, "utf8");
}

if (!artifactRaw) throw new Error("No artifact payload loaded");
if (!resolvedIssueId) throw new Error("Could not determine issueNumber");

// Validate JSON
let parsedArtifact;
try {
  parsedArtifact = JSON.parse(artifactRaw);
} catch {
  throw new Error("Artifact is not valid JSON");
}

if (!parsedArtifact.issue || !parsedArtifact.signature) {
  throw new Error("Artifact missing required fields: issue + signature");
}

if (parsedArtifact.issue.issueNumber !== resolvedIssueId) {
  throw new Error(
    `Issue mismatch: stdin/file issueNumber=${parsedArtifact.issue.issueNumber} but resolved=${resolvedIssueId}`
  );
}

// Store issue payload
await client.set(`issue:${resolvedIssueId}`, artifactRaw);

// Store latest pointer
await client.set("issue:latest", String(resolvedIssueId));

console.log(`✅ Published issue #${resolvedIssueId} to Redis`);
console.log(`   issue:${resolvedIssueId}`);
console.log(`   issue:latest -> ${resolvedIssueId}`);

await client.quit();