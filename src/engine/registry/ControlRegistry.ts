import type { ControlDefinition } from "../contracts/ControlDefinition.js";

export const ControlRegistry: {
  controls: Record<string, ControlDefinition>;
} = {
  controls: {
    "governance.aiGovernancePolicy": {
      id: "GOV-001",
      title: "AI Governance Policy Documented",
      description:
        "Formal AI governance policy covering lifecycle oversight and accountability.",

      domain: "Governance",
      riskCategory: "Governance",

      severity: "High",
      controlType: "Preventive",

      baseWeight: 5
    },

    "monitoring.modelMonitoring": {
      id: "MON-001",
      title: "Model Monitoring",
      description:
        "Ongoing monitoring of AI models for drift, performance, and failures.",

      domain: "Monitoring",
      riskCategory: "Operational",

      severity: "High",
      controlType: "Detective",

      baseWeight: 5
    },

    "businessContinuity.recoveryPlan": {
      id: "BC-006",
      title: "Recovery Point Objective Defined",
      description:
        "Defined recovery objectives for AI-supported systems.",

      domain: "Business Continuity",
      riskCategory: "Operational Resilience",

      severity: "Medium",
      controlType: "Corrective",

      baseWeight: 4
    }
  }
};
