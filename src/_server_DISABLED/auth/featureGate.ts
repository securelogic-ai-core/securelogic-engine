import { LicenseTier } from "../../contracts/LicenseTier";

export type Feature =
  | "RISK_SCORING"
  | "MATERIAL_RISKS"
  | "PDF_EXPORT";

const FEATURE_MATRIX: Record<LicenseTier, Feature[]> = {
  FREE: [],
  PRO: ["RISK_SCORING", "MATERIAL_RISKS"],
  ENTERPRISE: ["RISK_SCORING", "MATERIAL_RISKS", "PDF_EXPORT"]
};

export function hasFeature(
  license: LicenseTier,
  feature: Feature
): boolean {
  return FEATURE_MATRIX[license]?.includes(feature) ?? false;
}
