"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var express_1 = require("express");
var RunnerEngine_1 = require("../../engine/RunnerEngine");
var AuditSprintPdf_1 = require("../../reports/AuditSprintPdf");
var resolveLicense_1 = require("../auth/resolveLicense");
var normalizeAuditSprintResult_1 = require("../adapters/normalizeAuditSprintResult");
var crypto_1 = require("crypto");
var router = (0, express_1.Router)();
router.post("/", function (req, res) {
    var _a;
    var license = (0, resolveLicense_1.resolveLicense)(req);
    if (license === "FREE") {
        return res.status(402).json({
            error: "PaymentRequired",
            message: "Upgrade to PRO to export reports"
        });
    }
    try {
        var rawResult = RunnerEngine_1.RunnerEngine.run(req.body);
        var result = (0, normalizeAuditSprintResult_1.normalizeAuditSprintResult)(rawResult);
        var reportId = crypto_1.default.randomUUID();
        var path = (0, AuditSprintPdf_1.generateAuditSprintPdf)(reportId, result);
        return res.status(200).json({
            reportId: reportId,
            path: path
        });
    }
    catch (err) {
        return res.status(500).json({
            error: "PdfGenerationFailed",
            message: (_a = err.message) !== null && _a !== void 0 ? _a : "Unknown error"
        });
    }
});
exports.default = router;
