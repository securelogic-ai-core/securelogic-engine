export type ApiTier = "free" | "pro" | "enterprise";

export type ApiKeyConfig = {
  tier: ApiTier;
};

export const API_KEYS: Record<string, ApiKeyConfig> = {
  "test123": { tier: "free" },
  "pro123": { tier: "pro" },
  "ent123": { tier: "enterprise" }
};
