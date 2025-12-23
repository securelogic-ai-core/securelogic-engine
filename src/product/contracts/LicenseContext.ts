import type { ProductTier } from "./ProductTier";

export interface LicenseContext {
  tier: ProductTier;
  customerId: string;
  expiresAt?: string;
}
