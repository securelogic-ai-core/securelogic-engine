import { ensureRedisConnected, redisReady } from "./redis.js";
import { logger } from "./logger.js";

const KEY_LATEST = "issues:latest";
const KEY_ARTIFACT_PREFIX = "issues:artifact:";

/**
 * Enterprise safety limits
 */
const MAX_ISSUE_ID = 10_000_000;
const MAX_ARTIFACT_BYTES = 512_000; // 512 KB hard cap
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
 * For issues data we FAIL CLOSED on publish, but on reads we degrade gracefully.
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
 * Enterprise: Validate that stored artifact is:
 * - valid JSON
 * - object
 * - contains expected top-level keys
 *
 * We do NOT validate full schema here — that's done in routes.
 * But we prevent garbage strings from ever being stored.
 */
function validateArtifactJsonOrThrow(artifactJson: string): void {
  if (typeof artifactJson !== "string") {
    throw new Error("invalid_artifact_json");
  }

  const trimmed = artifactJson.trim();
  if (trimmed.length === 0) {
    throw new Error("invalid_artifact_json");
  }

  // Must be JSON object (not a partial fragment)
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    throw new Error("artifact_not_json_object");
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error("artifact_invalid_json");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("artifact_invalid_shape");
  }

  /**
   * Minimal structural check:
   * must contain { issue: ..., signature: ... }
   */
  const obj = parsed as Record<string, unknown>;

  if (!("issue" in obj) || !("signature" in obj)) {
    throw new Error("artifact_missing_required_fields");
  }

  if (typeof obj.signature !== "string" || obj.signature.trim().length < 16) {
    throw new Error("artifact_signature_invalid");
  }

  if (!obj.issue || typeof obj.issue !== "object") {
    throw new Error("artifact_issue_invalid");
  }
}

/**
 * Enterprise: node-redis multi().exec() can return:
 * - modern: [res1, res2]
 * - old: [[null,res1],[null,res2]]
 *
 * We validate we got at least 2 results and they look OK.
 */
function isValidMultiExecResult(raw: unknown, expectedLen: number): boolean {
  if (!Array.isArray(raw)) return false;
  if (raw.length < expectedLen) return false;

  // If old shape, each item is [err, res]
  const first = raw[0];
  if (Array.isArray(first) && first.length >= 2) {
    for (const item of raw) {
      if (!Array.isArray(item) || item.length < 2) return false;
      const err = item[0];
      if (err) return false;
    }
    return true;
  }

  // If modern shape, we assume redis threw if it failed.
  return true;
}

/**
 * issues:latest -> "4"
 * issues:artifact:4 -> "{...signedIssueArtifactJson...}"
 *
 * Enterprise rules:
 * - In production, Redis must be configured.
 * - Redis calls must be time-boxed.
 * - Redis data must be validated.
 * - Publish must be atomic.
 */

export async function getLatestIssueId(): Promise<number> {
  if (!redisReady) {
    if (isProd()) {
      logger.error(
        { component: "issueStore", fn: "getLatestIssueId" },
        "Redis not configured in production (fail-closed)"
      );
      return 0;
    }

    return 0;
  }

  try {
    const redis = await withTimeout(ensureRedisConnected(), REDIS_TIMEOUT_MS);
    const raw = await withTimeout(redis.get(KEY_LATEST), REDIS_TIMEOUT_MS);

    const latest = safeNumberFromRedis(raw);
    if (!latest) return 0;

    return latest;
  } catch (err) {
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

    // Hard cap payload size
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

    /**
     * Enterprise: validate artifact is valid JSON before returning.
     * If corrupted, treat as missing.
     */
    try {
      validateArtifactJsonOrThrow(raw);
    } catch (err) {
      logger.error(
        {
          err,
          component: "issueStore",
          fn: "getIssueArtifact",
          issueNumber
        },
        "Issue artifact was corrupted / invalid JSON"
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

  if (!redisReady) {
    throw new Error("redis_not_configured");
  }

  if (typeof artifactJson !== "string" || artifactJson.trim() === "") {
    throw new Error("invalid_artifact_json");
  }

  // Hard cap payload size
  const bytes = Buffer.byteLength(artifactJson, "utf8");
  if (bytes > MAX_ARTIFACT_BYTES) {
    throw new Error("artifact_too_large");
  }

  /**
   * 🚨 CRITICAL ENTERPRISE FIX:
   * Validate JSON BEFORE storing.
   * This prevents corrupted artifacts from ever being published.
   */
  validateArtifactJsonOrThrow(artifactJson);

  const redis = await withTimeout(ensureRedisConnected(), REDIS_TIMEOUT_MS);

  /**
   * Atomic publish:
   * - write artifact
   * - update latest pointer
   */
  const execRes = await withTimeout(
    redis
      .multi()
      .set(artifactKey(issueNumber), artifactJson)
      .set(KEY_LATEST, String(issueNumber))
      .exec(),
    REDIS_TIMEOUT_MS
  );

  if (!isValidMultiExecResult(execRes, 2)) {
    logger.error(
      {
        component: "issueStore",
        fn: "publishIssueArtifact",
        issueNumber,
        execResType: typeof execRes
      },
      "Redis multi exec returned invalid result"
    );

    throw new Error("redis_publish_failed");
  }

  logger.info(
    {
      component: "issueStore",
      fn: "publishIssueArtifact",
      issueNumber,
      bytes
    },
    "Issue artifact published"
  );
}