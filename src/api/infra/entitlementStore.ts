import { ensureRedisConnected, redisReady } from "./redis.js";

export type Tier = "free" | "paid" | "admin";

export type EntitlementRecord = {
  tier: Tier;
  activeSubscription: boolean;
};

/**
 * Redis keys (CURRENT):
 * entitlement:<apiKey> -> {"tier":"paid","activeSubscription":true}
 *
 * Legacy bug key (OLD):
 * entitlements:<apiKey> -> {"tier":"paid","activeSubscription":true}
 *
 * NOTE:
 * We READ both temporarily to support migration.
 * We only WRITE the correct key.
 */

function isTier(value: unknown): value is Tier {
  return value === "free" || value === "paid" || value === "admin";
}

function isValidEntitlementRecord(value: unknown): value is EntitlementRecord {
  if (!value || typeof value !== "object") return false;

  const tier = (value as any).tier as unknown;
  const activeSubscription = (value as any).activeSubscription as unknown;

  if (!isTier(tier)) return false;
  if (typeof activeSubscription !== "boolean") return false;

  // Hard invariants (enterprise):
  // - free must always be false
  if (tier === "free" && activeSubscription !== false) return false;

  // - paid/admin must always be true
  if ((tier === "paid" || tier === "admin") && activeSubscription !== true) {
    return false;
  }

  return true;
}

function entitlementKey(apiKey: string): string {
  return `entitlement:${apiKey}`;
}

function legacyBugKey(apiKey: string): string {
  return `entitlements:${apiKey}`;
}

export async function getEntitlementFromRedis(
  apiKey: string
): Promise<EntitlementRecord | null> {
  if (!redisReady) return null;

  const redis = await ensureRedisConnected();

  // Prefer correct key
  const correctRaw = await redis.get(entitlementKey(apiKey));

  if (correctRaw) {
    try {
      const parsed = JSON.parse(correctRaw) as unknown;
      if (!isValidEntitlementRecord(parsed)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * Legacy fallback:
   * Read old bug key ONLY if correct key is missing.
   */
  const legacyRaw = await redis.get(legacyBugKey(apiKey));

  if (!legacyRaw) return null;

  try {
    const parsed = JSON.parse(legacyRaw) as unknown;
    if (!isValidEntitlementRecord(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function setEntitlementInRedis(
  apiKey: string,
  record: EntitlementRecord
): Promise<void> {
  if (!redisReady) return;

  // Fail-safe: never write invalid records
  if (!isValidEntitlementRecord(record)) return;

  const redis = await ensureRedisConnected();

  // Always write to correct key
  await redis.set(entitlementKey(apiKey), JSON.stringify(record));

  /**
   * Optional cleanup:
   * If legacy key exists, remove it to complete migration.
   */
  try {
    await redis.del(legacyBugKey(apiKey));
  } catch {
    // ignore cleanup errors
  }
}

export async function deleteEntitlementFromRedis(apiKey: string): Promise<void> {
  if (!redisReady) return;

  const redis = await ensureRedisConnected();

  // Delete both keys (correct + legacy)
  await redis.del(entitlementKey(apiKey));
  await redis.del(legacyBugKey(apiKey));
}