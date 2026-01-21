import type { ControlDefinition } from "../../contracts/ControlDefinition.js";

export const BusinessContinuityControls: Record<string, ControlDefinition> = {
  "businessContinuity.rpoDefined": {
    id: "BC-006",
    title: "Recovery Point Objective Defined",
    description: "RPO targets are defined for AI systems.",

    domain: "BusinessContinuity",
    riskCategory: "BusinessContinuity",

    severity: "Moderate",

    baseWeight: 4,

    frameworks: {
      soc2: "CC7.4"
    },

    maturityHint: "Define RPOs aligned to business impact.",
    rationaleTemplate: "Recovery point objectives are undefined or undocumented."
  }
};
