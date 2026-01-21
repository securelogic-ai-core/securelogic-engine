import type { ControlDefinition } from "../../contracts/ControlDefinition.js";

export const NISTAIRMFControls: ControlDefinition[] = [
  {
    id: "NIST-GOV-1",
    title: "AI Risk Management Strategy",
    description: "Organization defines and maintains an AI risk management strategy.",
    domain: "Governance",
    riskCategory: "Risk Management",
    severity: "High",
    baseWeight: 10
  },
  {
    id: "NIST-MAP-1",
    title: "AI System Context Mapping",
    description: "Organization documents intended purpose, users, and impacts of AI systems.",
    domain: "Governance",
    riskCategory: "Context",
    severity: "High",
    baseWeight: 8
  },
  {
    id: "NIST-MEAS-1",
    title: "AI Risk Measurement",
    description: "Organization measures and tracks AI risks over time.",
    domain: "Monitoring",
    riskCategory: "Measurement",
    severity: "High",
    baseWeight: 9
  },
  {
    id: "NIST-MAN-1",
    title: "AI Risk Treatment",
    description: "Organization defines and executes AI risk response actions.",
    domain: "Governance",
    riskCategory: "Mitigation",
    severity: "High",
    baseWeight: 9
  }
];
