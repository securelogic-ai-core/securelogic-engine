import { ENTITLEMENT_MATRIX } from "../contracts/entitlements/EntitlementMatrix";

export function generateFeatureMatrix() {
  return Object.entries(ENTITLEMENT_MATRIX).map(([tier, features]) => ({
    tier,
    ...features
  }));
}
