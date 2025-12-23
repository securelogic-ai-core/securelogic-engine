"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var express_1 = require("express");
var router = (0, express_1.Router)();
/**
 * Captures upgrade intent for monetization follow-up
 */
router.post("/", function (req, res) {
    var _a = req.body, email = _a.email, company = _a.company, desiredTier = _a.desiredTier;
    if (!email || !desiredTier) {
        return res.status(400).json({
            error: "InvalidRequest",
            message: "email and desiredTier are required"
        });
    }
    // TEMP: log intent (replace with DB/CRM later)
    console.log("UPGRADE INTENT:", {
        email: email,
        company: company,
        desiredTier: desiredTier,
        timestamp: new Date().toISOString()
    });
    return res.status(202).json({
        status: "captured",
        message: "Upgrade request received. Sales will contact you."
    });
});
exports.default = router;
