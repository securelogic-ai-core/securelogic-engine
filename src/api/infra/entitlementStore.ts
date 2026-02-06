import { ensureRedisConnected, redisReady } from "./redis.js";

export type Tier = "free" | "paid" | "admin";

export type EntitlementRecord = {
  tier: Tier;
  activeSubscription: boolean;
};

/**
 * Redis keys:
 * entitlement:{apiKey} -> {"tier":"paid","activeSubscription":true}
 */

export async function getEntitlementFromRedis(
  apiKey: string
): Promise<EntitlementRecord | null> {
  if (!redisReady) return null;

  const redis = await ensureRedisConnected();
  const raw = await redis.get(`entitlement:${apiKey}`);

  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as unknown;

    if (!parsed || typeof parsed !== "object") return null;

    const tier = (parsed as any).tier as Tier;
    const activeSubscription = (parsed as any).activeSubscription as boolean;

    if (tier !== "free" && tier !== "paid" && tier !== "admin") return null;
    if (typeof activeSubscription !== "boolean") return null;

    return { tier, activeSubscription };
  } catch {
    return null;
  }
}

export async function setEntitlementInRedis(
  apiKey: string,
  record: EntitlementRecord
): Promise<void> {
  if (!redisReady) return;

  const redis = await ensureRedisConnected();
  await redis.set(`entitlement:${apiKey}`, JSON.stringify(record));
}

export async function deleteEntitlementFromRedis(apiKey: string): Promise<void> {
  if (!redisReady) return;

  const redis = await ensureRedisConnected();
  await redis.del(`entitlement:${apiKey}`);
}
