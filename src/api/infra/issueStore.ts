import { ensureRedisConnected, redisReady } from "./redis.js";

/**
 * issues:latest -> "4"
 * issues:artifact:4 -> "{...signedIssueArtifactJson...}"
 */

export async function getLatestIssueId(): Promise<number> {
  if (!redisReady) return 0;

  const redis = await ensureRedisConnected();
  const v = await redis.get("issues:latest");
  return v ? Number(v) : 0;
}

export async function getIssueArtifact(issueNumber: number): Promise<string | null> {
  if (!redisReady) return null;

  const redis = await ensureRedisConnected();
  return await redis.get(`issues:artifact:${issueNumber}`);
}

export async function publishIssueArtifact(
  issueNumber: number,
  artifactJson: string
): Promise<void> {
  if (!redisReady) return;

  const redis = await ensureRedisConnected();

  // Store the artifact
  await redis.set(`issues:artifact:${issueNumber}`, artifactJson);

  // Update latest pointer
  await redis.set("issues:latest", String(issueNumber));
}
