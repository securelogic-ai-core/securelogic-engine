import type { ControlDefinition } from "../../contracts/ControlDefinition.js";

export const AIGovernanceControls: ControlDefinition[] = [
  {
    id: "AI-GOV-1",
    title: "AI Inventory Exists",
    domain: "Governance",
    riskCategory: "Governance",
    description: "Organization maintains inventory of AI systems",
    severity: "High",
    baseWeight: 5,
    question: "Do you maintain a complete inventory of AI systems?",
    frameworks: {
      "AI-GOV": "Inventory"
    },
    dynamicModifiers: {
      enterpriseScale: 2,
      highRiskIndustry: 2
    }
  },
  {
    id: "AI-GOV-2",
    title: "AI Risk Assessment Process",
    domain: "Governance",
    riskCategory: "Governance",
    description: "Formal AI risk assessment process exists",
    severity: "Critical",
    baseWeight: 8,
    question: "Do you perform formal AI risk assessments?",
    frameworks: {
      "AI-GOV": "Risk"
    },
    dynamicModifiers: {
      enterpriseScale: 3,
      highRiskIndustry: 3,
      sensitiveData: 2
    }
  }
];
