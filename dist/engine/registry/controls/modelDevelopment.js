"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModelDevelopmentControls = void 0;
exports.ModelDevelopmentControls = {
    "modelDevelopment.validationTesting": {
        id: "MD-001",
        title: "Model Validation Testing",
        description: "Models are validated prior to deployment.",
        domain: "Model Development",
        riskCategory: "Model Development",
        severity: "High",
        controlType: "Preventive",
        frameworks: { iso42001: "A.7.3", nistAiRmf: "MEASURE-2" },
        baseWeight: 5,
        maturityHint: "Standardize validation gates before promotion.",
        rationaleTemplate: "Model validation testing is incomplete or informal."
    }
};
