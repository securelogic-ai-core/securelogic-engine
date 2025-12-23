"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var express_1 = require("express");
var freeTierLimit_1 = require("../middleware/freeTierLimit");
var router = (0, express_1.Router)();
router.post("/reset-free-tier", function (_req, res) {
    (0, freeTierLimit_1.resetFreeTier)();
    res.json({ status: "reset" });
});
exports.default = router;
