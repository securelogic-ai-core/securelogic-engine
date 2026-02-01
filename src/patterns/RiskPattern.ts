import type { Signal } from "../signals/Signal.js";

export type RiskPattern = {
  id: string;
  title: string;
  description: string;
  signals: Signal[];
  domains: string[];
  impactLevel: "MODERATE" | "HIGH" | "CRITICAL";
};
