import { EnterpriseRiskSummary } from "../contracts/EnterpriseRiskSummary";
import { ExecutiveNarrative } from "../contracts/ExecutiveNarrative";

export class ExecutiveNarrativeEngine {
  static generate(
    enterprise: EnterpriseRiskSummary
  ): ExecutiveNarrative {
    const drivers = enterprise.topRiskDrivers;

    if (enterprise.severity === "Critical") {
      return {

        severity: "Critical",
        title: "Critical AI Governance and Operational Risk",
        summary:
          "The organization faces material AI governance and control gaps that could result in regulatory action, operational disruption, or reputational damage.",
        businessImpact:
          "Without immediate remediation, AI systems may operate without adequate oversight, increasing exposure to compliance violations and unmanaged model behavior.",
        recommendedAction:
          "Executive leadership should mandate immediate remediation plans, assign accountable owners, and require quarterly oversight reporting.",
        drivers
      };
    }

    if (enterprise.severity === "High") {
      return {

        severity: "High",
        title: "Elevated AI Risk Requiring Leadership Attention",
        summary:
          "Several high-impact AI control gaps were identified that increase organizational exposure if left unaddressed.",
        businessImpact:
          "Failure to remediate these issues may lead to increased regulatory scrutiny, control failures, or erosion of stakeholder trust.",
        recommendedAction:
          "Leadership should prioritize remediation initiatives and establish clear accountability and timelines.",
        drivers
      };
    }

    if (enterprise.severity === "Moderate") {
      return {

        severity: "Moderate",
        title: "Moderate AI Risk with Improvement Opportunities",
        summary:
          "AI governance controls are partially implemented, but gaps remain that could elevate risk as AI usage scales.",
        businessImpact:
          "As AI adoption increases, these gaps may compound and result in higher operational or compliance risk.",
        recommendedAction:
          "Management should incorporate AI control enhancements into planned improvement roadmaps.",
        drivers
      };
    }

    return {

      severity: "Low",
      title: "Low AI Risk Posture",
      summary:
        "AI governance and control structures are largely effective with no material risk indicators identified.",
      businessImpact:
        "Current controls support responsible AI usage and reduce the likelihood of material adverse outcomes.",
      recommendedAction:
        "Continue monitoring and periodically reassess controls as AI usage evolves.",
      drivers
    };
  }
}
