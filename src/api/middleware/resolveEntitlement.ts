import type { Request, Response, NextFunction } from "express";
import {
  getEntitlementFromRedis,
  type Tier,
  type EntitlementRecord
} from "../infra/entitlementStore.js";

type EnvEntitlement =
  | Tier
  | {
      tier: Tier;
      activeSubscription: boolean;
    };

function isTier(value: unknown): value is Tier {
  return value === "free" || value === "paid" || value === "admin";
}

function loadEnvEntitlements(): Record<string, EnvEntitlement> {
  const raw = process.env.SECURELOGIC_ENTITLEMENTS ?? "{}";

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, EnvEntitlement>;
  } catch {
    return {};
  }
}

function normalizeEnvEntitlement(raw: EnvEntitlement): EntitlementRecord | null {
  // Allow simple form: { "key": "paid" }
  if (typeof raw === "string") {
    if (!isTier(raw)) return null;

    return {
      tier: raw,
      activeSubscription: raw !== "free"
    };
  }

  // Allow object form: { "key": { tier: "paid", activeSubscription: true } }
  if (!raw || typeof raw !== "object") return null;

  const tier = (raw as any).tier as unknown;
  const activeSubscription = (raw as any).activeSubscription as unknown;

  if (!isTier(tier)) return null;
  if (typeof activeSubscription !== "boolean") return null;

  return { tier, activeSubscription };
}

export async function resolveEntitlement(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const apiKey = (req as any).apiKey as string | undefined;

  if (!apiKey) {
    res.status(401).json({ error: "api_key_required" });
    return;
  }

  // Ensure downstream middleware ALWAYS has it
  (req as any).apiKey = apiKey;

  /**
   * =========================================================
   * 1) Redis entitlements (authoritative)
   *
   * IMPORTANT:
   * We support BOTH namespaces:
   * - entitlements_v2:<apiKey>  (webhook-driven)
   * - entitlements:<apiKey>     (legacy/admin)
   * =========================================================
   */
  const redisEnt = await getEntitlementFromRedis(apiKey);

  if (redisEnt) {
    (req as any).entitlement = redisEnt.tier;
    (req as any).activeSubscription = redisEnt.activeSubscription;
    next();
    return;
  }

  /**
   * =========================================================
   * 2) Env fallback (bootstrap/dev)
   * =========================================================
   */
  const envEntitlements = loadEnvEntitlements();
  const rawEnv = envEntitlements[apiKey];

  if (!rawEnv) {
    res.status(403).json({ error: "entitlement_missing" });
    return;
  }

  const normalized = normalizeEnvEntitlement(rawEnv);

  if (!normalized) {
    res.status(403).json({ error: "entitlement_invalid" });
    return;
  }

  (req as any).entitlement = normalized.tier;
  (req as any).activeSubscription = normalized.activeSubscription;

  next();
}