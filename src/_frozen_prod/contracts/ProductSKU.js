"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PRODUCT_SKUS = void 0;
exports.PRODUCT_SKUS = {
    Starter: {
        name: "Starter Risk Decision",
        priceRangeUSD: [499, 499],
        intendedBuyer: "Founders, early-stage teams",
        deliverables: [
            "Risk approval decision",
            "Overall risk severity"
        ]
    },
    Professional: {
        name: "Executive Risk Assessment",
        priceRangeUSD: [5000, 7500],
        intendedBuyer: "SMBs, compliance teams",
        deliverables: [
            "Executive risk report (PDF)",
            "Risk decision & rationale",
            "Remediation plan"
        ]
    },
    Enterprise: {
        name: "Enterprise Risk & Pricing Analysis",
        priceRangeUSD: [20000, 35000],
        intendedBuyer: "Enterprises, boards, regulators",
        deliverables: [
            "Executive risk report (PDF)",
            "Risk decision & rationale",
            "Remediation plan",
            "Pricing & complexity justification"
        ]
    }
};
