export interface ApiKey {
  key: string;
  tier: "FREE" | "PRO" | "ENTERPRISE";
  revoked?: boolean;
}
