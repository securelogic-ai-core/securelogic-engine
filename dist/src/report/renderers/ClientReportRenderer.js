"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClientReportRenderer = void 0;
const ExecutiveRiskReportV2PdfRenderer_1 = require("./ExecutiveRiskReportV2PdfRenderer");
class ClientReportRenderer {
    static renderExecutive(report) {
        return ExecutiveRiskReportV2PdfRenderer_1.ExecutiveRiskReportV2PdfRenderer.render(report);
    }
}
exports.ClientReportRenderer = ClientReportRenderer;
