"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClientReportRenderer = void 0;
var ExecutiveRiskReportV2PdfRenderer_1 = require("./ExecutiveRiskReportV2PdfRenderer");
var ClientReportRenderer = /** @class */ (function () {
    function ClientReportRenderer() {
    }
    ClientReportRenderer.renderExecutive = function (report) {
        return ExecutiveRiskReportV2PdfRenderer_1.ExecutiveRiskReportV2PdfRenderer.render(report);
    };
    return ClientReportRenderer;
}());
exports.ClientReportRenderer = ClientReportRenderer;
