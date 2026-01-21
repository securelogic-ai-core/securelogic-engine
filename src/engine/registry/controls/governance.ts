import type { ControlDefinition } from "../../contracts/ControlDefinition.js";

export const governanceControls: Record<string, ControlDefinition> = {
  "governance.policy": {
    id: "GOV-101",
    title: "AI Governance Policy",
    description: "Documented AI governance policy and oversight structure.",

    domain: "Governance",
    riskCategory: "Governance",

    severity: "High",

    baseWeight: 5,

    frameworks: {
      iso42001: "A.5.1",
      nistAiRmf: "GOV-1"
    },

    maturityHint: "Formalize policy approval and review cadence.",
    rationaleTemplate: "AI governance policy is missing or incomplete."
  },

  "governance.accountability": {
    id: "GOV-102",
    title: "AI Risk Ownership Defined",
    description: "Clear accountability for AI risks and decisions.",

    domain: "Governance",
    riskCategory: "Governance",

    severity: "High",

    baseWeight: 5,

    frameworks: {
      iso42001: "A.5.2",
      nistAiRmf: "GOV-2"
    },

    maturityHint: "Assign executive ownership for AI risk.",
    rationaleTemplate: "AI risk ownership is unclear or undocumented."
  }
};
