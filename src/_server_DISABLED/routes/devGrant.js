"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var express_1 = require("express");
var store_1 = require("../entitlements/store");
var router = (0, express_1.Router)();
router.post("/grant-audit-sprint", function (req, res) {
    var email = req.body.email;
    if (!email) {
        return res.status(400).json({ error: "EMAIL_REQUIRED" });
    }
    (0, store_1.grantAuditSprint)(email, "DEV", "manual-dev");
    return res.status(200).json({
        status: "granted",
        product: "AUDIT_SPRINT",
        email: email
    });
});
exports.default = router;
