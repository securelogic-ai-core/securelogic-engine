import type { Request, Response, NextFunction } from "express";

type Tier = "free" | "paid" | "admin";

type Entitlement =
  | Tier
  | {
      tier: Tier;
      activeSubscription: boolean;
    };

function loadEntitlements(): Record<string, Entitlement> {
  const raw = process.env.SECURELOGIC_ENTITLEMENTS ?? "{}";

  try {
    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== "object") return {};

    return parsed as Record<string, Entitlement>;
  } catch {
    return {};
  }
}

function extractApiKey(req: Request): string | null {
  const fromReq = (req as any).apiKey as string | undefined;
  if (fromReq?.trim()) return fromReq.trim();

  const fromSecurelogic = req.get("x-securelogic-key");
  if (fromSecurelogic?.trim()) return fromSecurelogic.trim();

  const fromApiKey = req.get("x-api-key");
  if (fromApiKey?.trim()) return fromApiKey.trim();

  const auth = req.get("authorization");
  const bearer = auth?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? null;
  if (bearer?.trim()) return bearer.trim();

  return null;
}

export function resolveEntitlement(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const apiKey = extractApiKey(req);

  if (!apiKey) {
    res.status(401).json({ error: "API key required (resolveEntitlement)" });
    return;
  }

  // IMPORTANT: ensure downstream middleware ALWAYS has it
  (req as any).apiKey = apiKey;

  const entitlements = loadEntitlements();
  const rawEntitlement = entitlements[apiKey];

  if (!rawEntitlement) {
    res.status(403).json({ error: "No entitlement assigned" });
    return;
  }

  let tier: Tier;
  let activeSubscription: boolean;

  // Case 1: "test_key_123": "paid"
  if (typeof rawEntitlement === "string") {
    tier = rawEntitlement as Tier;
    activeSubscription = tier !== "free";
  } else {
    // Case 2: "test_key_123": { tier: "paid", activeSubscription: true }
    tier = rawEntitlement.tier;
    activeSubscription = rawEntitlement.activeSubscription;
  }

  (req as any).entitlement = tier;
  (req as any).activeSubscription = activeSubscription;

  next();
}