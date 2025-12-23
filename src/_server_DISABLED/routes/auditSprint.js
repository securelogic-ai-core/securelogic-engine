"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var express_1 = require("express");
var crypto_1 = require("crypto");
var RunnerEngine_1 = require("../../engine/RunnerEngine");
var auditSprintStore_1 = require("../store/auditSprintStore");
var router = (0, express_1.Router)();
router.post("/intake", function (req, res) {
    var input = req.body;
    if (!(input === null || input === void 0 ? void 0 : input.email) || typeof input.email !== "string") {
        return res.status(400).json({ error: "EMAIL_REQUIRED" });
    }
    var result = RunnerEngine_1.RunnerEngine.run(input);
    var auditId = (0, crypto_1.randomUUID)();
    (0, auditSprintStore_1.saveAuditResult)(auditId, input.email, result);
    return res.status(202).json({
        status: "accepted",
        auditId: auditId
    });
});
exports.default = router;
