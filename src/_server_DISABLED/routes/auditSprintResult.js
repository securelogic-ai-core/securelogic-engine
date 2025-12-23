"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var express_1 = require("express");
var auditSprintStore_1 = require("../store/auditSprintStore");
var router = (0, express_1.Router)();
router.get("/:id", function (req, res) {
    var email = req.query.email;
    if (!email || typeof email !== "string") {
        return res.status(400).json({ error: "EMAIL_REQUIRED" });
    }
    var result = (0, auditSprintStore_1.getAuditResult)(req.params.id, email);
    if (!result) {
        return res.status(404).json({ error: "NotFound" });
    }
    return res.json(result);
});
exports.default = router;
