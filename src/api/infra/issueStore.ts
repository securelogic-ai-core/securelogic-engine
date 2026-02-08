import { ensureRedisConnected, redisReady } from "./redis.js";
import { logger } from "./logger.js";

const KEY_LATEST = "issues:latest";
const KEY_ARTIFACT_PREFIX = "issues:artifact:";

/**
 * Enterprise safety limits
 */
const MAX_ISSUE_ID = 10_000_000;
const MAX_ARTIFACT_BYTES = 512_000; // 512 KB hard cap (adjust later if needed)
const REDIS_TIMEOUT_MS = 1200;

function isProd(): boolean {
  return process.env.NODE_ENV === "production";
}

function isValidIssueNumber(n: unknown): n is number {
  return (
    typeof n === "number" &&
    Number.isFinite(n) &&
    Number.isInteger(n) &&
    n > 0 &&
    n <= MAX_ISSUE_ID
  );
}

function safeNumberFromRedis(raw: string | null): number | null {
  if (!raw) return null;

  // Redis could contain garbage. We only accept digits.
  const v = raw.trim();

  if (!/^\d+$/.test(v)) return null;

  const n = Number(v);

  if (!isValidIssueNumber(n)) return null;

  return n;
}

function artifactKey(issueNumber: number): string {
  return `${KEY_ARTIFACT_PREFIX}${issueNumber}`;
}

/**
 * Promise timeout wrapper.
 * If Redis stalls, we FAIL CLOSED (for issues) because this is core business data.
 */
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timeoutId: NodeJS.Timeout | null = null;

  const timeoutPromise = new Promise<T>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`redis_timeout_after_${ms}ms`));
    }, ms);

    timeoutId.unref?.();
  });

  return Promise.race([p, timeoutPromise]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

/**
 * issues:latest -> "4"
 * issues:artifact:4 -> "{...signedIssueArtifactJson...}"
 *
 * Enterprise rules:
 * - In production, Redis must be configured.
 * - Redis calls must be time-boxed.
 * - All Redis data must be validated.
 */

export async function getLatestIssueId(): Promise<number> {
  /**
   * Enterprise rule:
   * If Redis is missing in production, this engine is not safe to run.
   */
  if (!redisReady) {
    if (isProd()) {
      logger.error(
        { component: "issueStore", fn: "getLatestIssueId" },
        "Redis not configured in production (fail-closed)"
      );
      return 0;
    }

    // dev/test convenience
    return 0;
  }

  try {
    const redis = await withTimeout(ensureRedisConnected(), REDIS_TIMEOUT_MS);

    const raw = await withTimeout(redis.get(KEY_LATEST), REDIS_TIMEOUT_MS);

    const latest = safeNumberFromRedis(raw);

    if (!latest) return 0;

    return latest;
  } catch (err) {
    /**
     * Enterprise rule:
     * If Redis fails, we do NOT throw.
     * We return 0 and let the route return 404 "no issues published".
     */
    logger.error(
      { err, component: "issueStore", fn: "getLatestIssueId" },
      "Redis read failed"
    );

    return 0;
  }
}

export async function getIssueArtifact(
  issueNumber: number
): Promise<string | null> {
  if (!isValidIssueNumber(issueNumber)) return null;

  if (!redisReady) {
    if (isProd()) {
      logger.error(
        { component: "issueStore", fn: "getIssueArtifact" },
        "Redis not configured in production (fail-closed)"
      );
      return null;
    }

    return null;
  }

  try {
    const redis = await withTimeout(ensureRedisConnected(), REDIS_TIMEOUT_MS);

    const raw = await withTimeout(
      redis.get(artifactKey(issueNumber)),
      REDIS_TIMEOUT_MS
    );

    if (!raw) return null;

    /**
     * Enterprise safety:
     * Prevent returning absurd payload sizes.
     */
    const bytes = Buffer.byteLength(raw, "utf8");
    if (bytes > MAX_ARTIFACT_BYTES) {
      logger.error(
        {
          component: "issueStore",
          fn: "getIssueArtifact",
          issueNumber,
          bytes
        },
        "Issue artifact exceeded maximum allowed size"
      );
      return null;
    }

    return raw;
  } catch (err) {
    logger.error(
      { err, component: "issueStore", fn: "getIssueArtifact", issueNumber },
      "Redis read failed"
    );
    return null;
  }
}

export async function publishIssueArtifact(
  issueNumber: number,
  artifactJson: string
): Promise<void> {
  if (!isValidIssueNumber(issueNumber)) {
    throw new Error("invalid_issue_number");
  }

  if (typeof artifactJson !== "string" || artifactJson.trim() === "") {
    throw new Error("invalid_artifact_json");
  }

  /**
   * Enterprise safety:
   * Hard cap payload size.
   */
  const bytes = Buffer.byteLength(artifactJson, "utf8");
  if (bytes > MAX_ARTIFACT_BYTES) {
    throw new Error("artifact_too_large");
  }

  if (!redisReady) {
    /**
     * Publishing without Redis is NOT allowed.
     */
    throw new Error("redis_not_configured");
  }

  const redis = await withTimeout(ensureRedisConnected(), REDIS_TIMEOUT_MS);

  /**
   * Enterprise rule:
   * Atomic publish:
   * - write artifact
   * - update latest pointer
   *
   * This prevents a state where latest points to a missing artifact.
   */
  const resMulti = await withTimeout(
    redis
      .multi()
      .set(artifactKey(issueNumber), artifactJson)
      .set(KEY_LATEST, String(issueNumber))
      .exec(),
    REDIS_TIMEOUT_MS
  );

  /**
   * If Redis returns weird results, fail closed.
   */
  if (!Array.isArray(resMulti) || resMulti.length < 2) {
    throw new Error("redis_publish_failed");
  }
}