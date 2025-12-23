"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RiskDecisionPdfRenderer = void 0;
var RiskDecisionPdfRenderer = /** @class */ (function () {
    function RiskDecisionPdfRenderer() {
    }
    RiskDecisionPdfRenderer.render = function (input) {
        var _a, _b;
        var decision = input.decision, assessment = input.assessment;
        return "\n      <html>\n        <body>\n          <h1>Risk Decision Report</h1>\n\n          <p><strong>Assessment Name:</strong> ".concat(assessment.name, "</p>\n          <p><strong>Assessment Date:</strong> ").concat(assessment.date, "</p>\n\n          <h2>Decision Summary</h2>\n          <p><strong>Risk Level:</strong> ").concat(decision.level, "</p>\n          <p><strong>Approval Status:</strong> ").concat(decision.approvalStatus, "</p>\n\n          <h3>Severity Rationale</h3>\n          <ul>\n            ").concat(((_a = decision.severityRationale) !== null && _a !== void 0 ? _a : [])
            .map(function (r) { return "<li>".concat(r, "</li>"); })
            .join(""), "\n          </ul>\n\n          <h3>Remediation Plan</h3>\n          <ul>\n            ").concat(((_b = decision.remediationPlan) !== null && _b !== void 0 ? _b : [])
            .map(function (r) {
            return "<li>".concat(r.description, " (Priority: ").concat(r.priority, ")</li>");
        })
            .join(""), "\n          </ul>\n        </body>\n      </html>\n    ");
    };
    return RiskDecisionPdfRenderer;
}());
exports.RiskDecisionPdfRenderer = RiskDecisionPdfRenderer;
