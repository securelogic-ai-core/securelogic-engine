import { redis } from "./redis.js";

const KEY_LATEST = "issues:latest";
const KEY_PREFIX = "issues:artifact:";

export async function setLatestIssueId(id: number): Promise<void> {
  await redis.set(KEY_LATEST, String(id));
}

export async function getLatestIssueId(): Promise<number | null> {
  const raw = await redis.get(KEY_LATEST);
  if (!raw) return null;

  const n = Number(raw);

  // strict: must be a valid positive integer
  if (!Number.isFinite(n) || n <= 0) return null;

  return n;
}

export async function putIssueArtifact(
  id: number,
  artifactJson: string
): Promise<void> {
  await redis.set(`${KEY_PREFIX}${id}`, artifactJson);
}

export async function getIssueArtifact(id: number): Promise<string | null> {
  return await redis.get(`${KEY_PREFIX}${id}`);
}

/**
 * Publish = store artifact AND update "latest" pointer.
 * This is what your Render admin route should call.
 */
export async function publishIssueArtifact(
  id: number,
  artifactJson: string
): Promise<void> {
  await putIssueArtifact(id, artifactJson);
  await setLatestIssueId(id);
}