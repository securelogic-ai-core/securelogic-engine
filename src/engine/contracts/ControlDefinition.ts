import type { CanonicalDomain } from "../taxonomy/Domains.js";

export type ControlDefinition = {
  id: string;
  title: string;
  description: string;

  domain: CanonicalDomain;

  riskCategory: string;
  severity: "Low" | "Moderate" | "High" | "Critical";
  baseWeight: number;

  // UX / Assessment
  question?: string;

  // Framework mapping
  frameworks?: Record<string, string>;

  // Risk weighting
  dynamicModifiers?: Record<string, number>;

  // Maturity guidance
  maturityHint?: string;

  // Finding narrative template
  rationaleTemplate?: string;
};
