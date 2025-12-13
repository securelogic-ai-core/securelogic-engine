"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BusinessContinuityControls = void 0;
exports.BusinessContinuityControls = {
    "businessContinuity.rpoDefined": {
        id: "BC-006",
        title: "Recovery Point Objective Defined",
        description: "RPO targets are defined for AI systems.",
        domain: "Business Continuity",
        riskCategory: "Business Continuity",
        severity: "Medium",
        controlType: "Corrective",
        baseWeight: 4,
        frameworks: {
            soc2: "CC7.4"
        },
        maturityHint: "Define RPOs aligned to business impact.",
        rationaleTemplate: "Recovery point objectives are undefined or undocumented."
    }
};
