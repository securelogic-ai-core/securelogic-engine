"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var express_1 = require("express");
var validateURO_1 = require("../../validation/validateURO");
var router = (0, express_1.Router)();
router.post("/", function (req, res) {
    var _a, _b, _c, _d, _e;
    try {
        var body = req.body;
        // Normalize legacy / flat intake payloads
        var normalizedInput = {
            email: body.email,
            orgProfile: (_a = body.orgProfile) !== null && _a !== void 0 ? _a : {
                industry: body.industry,
                size: body.size,
                aiUsage: (_b = body.aiUsage) !== null && _b !== void 0 ? _b : []
            },
            system: body.system,
            triggers: (_c = body.triggers) !== null && _c !== void 0 ? _c : [],
            controls: (_d = body.controls) !== null && _d !== void 0 ? _d : {},
            metadata: (_e = body.metadata) !== null && _e !== void 0 ? _e : {}
        };
        var uro = (0, validateURO_1.validateURO)(normalizedInput);
        return res.status(200).json({
            status: "accepted",
            uroId: uro.id
        });
    }
    catch (err) {
        console.error("INTAKE FAILED:", err);
        return res.status(400).json({
            error: "AUDIT_FAILED",
            message: err.message
        });
    }
});
exports.default = router;
