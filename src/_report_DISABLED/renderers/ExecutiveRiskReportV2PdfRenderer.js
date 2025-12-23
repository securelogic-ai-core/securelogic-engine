"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExecutiveRiskReportV2PdfRenderer = void 0;
var ExecutiveRiskReportV2PdfRenderer = /** @class */ (function () {
    function ExecutiveRiskReportV2PdfRenderer() {
    }
    ExecutiveRiskReportV2PdfRenderer.render = function (report) {
        return "\nEXECUTIVE RISK REPORT\n====================\n\nAssessment: ".concat(report.assessment.name, "\nDate: ").concat(report.assessment.date, "\n\nRISK DECISION\n-------------\nLevel: ").concat(report.decision.level, "\nApproval Status: ").concat(report.decision.approvalStatus, "\n\nEXECUTIVE SUMMARY\n-----------------\n").concat(report.executiveNarrative, "\n\nREMEDIATION PLAN\n----------------\n").concat(report.remediationPlan.items
            .map(function (i) { return "- ".concat(i.description, " (Priority: ").concat(i.priority, ")"); })
            .join("\n"), "\n\n").concat(report.pricing
            ? "\nPRICING\n-------\nTier: ".concat(report.pricing.tier, "\nEstimated Annual Cost: $").concat(report.pricing.estimatedAnnualCost, "\n")
            : "", "\n").trim();
    };
    return ExecutiveRiskReportV2PdfRenderer;
}());
exports.ExecutiveRiskReportV2PdfRenderer = ExecutiveRiskReportV2PdfRenderer;
