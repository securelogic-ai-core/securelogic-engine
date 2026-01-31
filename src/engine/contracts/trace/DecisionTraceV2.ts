
// src/engine/contracts/trace/DecisionTraceV2.ts

export type DecisionTraceDirection = "UP" | "DOWN" | "FLAT";

export type DecisionTraceDriver = {
  id: string;
  label: string;
  weight: number;
  delta: number;
  direction: DecisionTraceDirection;
};

export type DecisionTraceV2 = {
  version: "2.0";

  decisionId: string;

  severity: "Low" | "Medium" | "High" | "Critical";

  drivers: DecisionTraceDriver[];

  framework?: string;

  domains?: Array<{
    name: string;
    score: number;
    contributingFindings: string[];
  }>;

  metadata?: {
    engineVersion?: string;
    generatedAt?: string;
  };
};