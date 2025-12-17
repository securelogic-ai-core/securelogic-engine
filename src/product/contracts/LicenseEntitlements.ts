export interface LicenseEntitlements {
  includesExecutiveReport: boolean;
  includesPricing: boolean;
  includesRemediationPlan: boolean;
}

export const LICENSE_ENTITLEMENTS: Record<
  "Starter" | "Professional" | "Enterprise",
  LicenseEntitlements
> = {
  Starter: {
    includesExecutiveReport: false,
    includesPricing: false,
    includesRemediationPlan: false
  },
  Professional: {
    includesExecutiveReport: true,
    includesPricing: false,
    includesRemediationPlan: true
  },
  Enterprise: {
    includesExecutiveReport: true,
    includesPricing: true,
    includesRemediationPlan: true
  }
};
