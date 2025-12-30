export interface RenderPolicyBinding {
  licenseTier: "CORE" | "PRO" | "ENTERPRISE";
  allowedTargets: string[];
  issuedForTenant: string;
}
