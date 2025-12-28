/**
 * Entitlements represent the effective feature permissions
 * resolved from license tier + SKU + flags.
 *
 * Consumed ONLY by enforcement layers.
 */
export interface Entitlements {
  allowExecutiveSummary: boolean;
  allowFindings: boolean;
  allowRiskRollup: boolean;
  allowIntegrity: boolean;
}
