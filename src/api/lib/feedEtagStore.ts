/**
 * feedEtagStore.ts — Redis-backed ETag persistence for conditional GET on
 * upstream feed bundles.
 *
 * Used by the MITRE ATT&CK and MITRE ATLAS adapters to send `If-None-Match`
 * on each fetch and short-circuit on 304. Generic enough that any future
 * adapter (NVD, MITRE D3FEND, vendor PSIRTs) can use the same key namespace
 * without further plumbing.
 *
 * Failure semantics
 * -----------------
 * Both `getEtag` and `setEtag` are best-effort:
 *   - If REDIS_URL is unset, both return without contacting Redis.
 *   - If the Redis call throws (connect timeout, network error, etc.), the
 *     error is logged at warn level and the function returns gracefully —
 *     `getEtag` returns null (so the caller does an unconditional fetch),
 *     `setEtag` discards the new ETag (next call will be unconditional too).
 *
 * The adapters MUST tolerate a null cached ETag and a failed setEtag, both
 * of which mean "do a normal fetch this time and try the cache again next
 * call". They MUST NOT throw on Redis problems — a Redis outage cannot kill
 * the brief cron.
 */

import { ensureRedisConnected, redisReady } from "../infra/redis.js";
import { logger } from "../infra/logger.js";

/**
 * Read the cached ETag for `key`. Returns null when Redis is unconfigured,
 * unreachable, or when no ETag has been stored yet.
 */
export async function getEtag(key: string): Promise<string | null> {
  if (!redisReady) return null;

  try {
    const client = await ensureRedisConnected();
    const value = await client.get(key);
    return value ?? null;
  } catch (err) {
    logger.warn(
      { event: "feed_etag_get_failed", key, err },
      "Failed to read cached ETag — falling back to unconditional fetch"
    );
    return null;
  }
}

/**
 * Persist the ETag returned on a 200 response so the next call can send it
 * as `If-None-Match`. Silently no-ops when Redis is unconfigured or
 * unreachable; the next call will simply do an unconditional fetch.
 *
 * No TTL is set — ETags are tied to upstream commit SHAs and remain valid
 * until the upstream feed publishes a new bundle. If a feed is decommissioned,
 * the stale key costs a few bytes; not worth a TTL guard.
 */
export async function setEtag(key: string, etag: string): Promise<void> {
  if (!redisReady) return;
  if (!etag) return;

  try {
    const client = await ensureRedisConnected();
    await client.set(key, etag);
  } catch (err) {
    logger.warn(
      { event: "feed_etag_set_failed", key, err },
      "Failed to persist ETag — next fetch will be unconditional"
    );
  }
}
