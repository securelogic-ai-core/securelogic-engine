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
  if (typeof raw === "string") {
    const tier = raw as Tier;
    return {
      tier,
      activeSubscription: tier !== "free"
    };
  }

  if (!raw || typeof raw !== "object") return null;

  const tier = raw.tier;
  const activeSubscription = raw.activeSubscription;

  if (tier !== "free" && tier !== "paid" && tier !== "admin") return null;
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
    res.status(401).json({ error: "API key required (resolveEntitlement)" });
    return;
  }

  // Ensure downstream middleware ALWAYS has it
  (req as any).apiKey = apiKey;

  // 1) Redis entitlements (authoritative)
  const redisEnt = await getEntitlementFromRedis(apiKey);

  if (redisEnt) {
    (req as any).entitlement = redisEnt.tier;
    (req as any).activeSubscription = redisEnt.activeSubscription;
    next();
    return;
  }

  // 2) Env fallback (bootstrap/dev)
  const envEntitlements = loadEnvEntitlements();
  const rawEnv = envEntitlements[apiKey];

  if (!rawEnv) {
    res.status(403).json({ error: "No entitlement assigned" });
    return;
  }

  const normalized = normalizeEnvEntitlement(rawEnv);

  if (!normalized) {
    res.status(403).json({ error: "Entitlement invalid" });
    return;
  }

  (req as any).entitlement = normalized.tier;
  (req as any).activeSubscription = normalized.activeSubscription;

  next();
}
