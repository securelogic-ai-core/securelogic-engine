import type { CanonicalDomain } from "../taxonomy/Domains.js";

export type ControlDefinition = {
  id: string;
  title: string;
  description: string;

  domain: CanonicalDomain;

  riskCategory: string;
  severity: "Low" | "Moderate" | "High" | "Critical";
  baseWeight: number;

  // Assessment UX
  question?: string;

  // 🔴 MULTI-FRAMEWORK MAPPING (THIS IS THE CORE)
  frameworks?: Record<string, string>;

  // Risk tuning
  dynamicModifiers?: Record<string, number>;

  // Maturity guidance
  maturityHint?: string;
  rationaleTemplate?: string;
};