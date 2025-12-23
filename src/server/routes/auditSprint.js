"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var express_1 = require("express");
var RunnerEngine_1 = require("../../engine/RunnerEngine");
var auditSprintValidator_1 = require("../validators/auditSprintValidator");
var resolveLicense_1 = require("../auth/resolveLicense");
var normalizeAuditSprintResult_1 = require("../adapters/normalizeAuditSprintResult");
var featureGate_1 = require("../auth/featureGate");
var router = (0, express_1.Router)();
router.post("/", function (req, res) {
    var validationError = (0, auditSprintValidator_1.validateAuditSprintInput)(req.body);
    if (validationError) {
        return res.status(400).json({
            error: "InvalidRequest",
            message: validationError
        });
    }
    var license = (0, resolveLicense_1.resolveLicense)(req);
    // ---- RUN ENGINE (STATIC) ----
    var engineResult = RunnerEngine_1.RunnerEngine.run(req.body);
    // ---- NORMALIZE ----
    var normalized = (0, normalizeAuditSprintResult_1.normalizeAuditSprintResult)(engineResult);
    // ---- FEATURE GATING ----
    if (!(0, featureGate_1.hasFeature)(license, "RISK_SCORING")) {
        return res.json({
            version: normalized.version,
            assessment: normalized.assessment,
            executiveSummary: {
                narrative: normalized.executiveSummary.narrative,
                overallRisk: normalized.executiveSummary.overallRisk
            },
            disclaimers: normalized.disclaimers
        });
    }
    // PRO / ENTERPRISE
    res.json(normalized);
});
exports.default = router;
