"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const handleRequest_1 = require("../handlers/handleRequest");
const router = (0, express_1.Router)();
router.post("/score", (req, res) => {
    try {
        const input = req.body;
        const result = (0, handleRequest_1.handleRequest)(input);
        res.json(result);
    }
    catch (err) {
        res.status(400).json({ error: err.message ?? "Unknown error" });
    }
});
exports.default = router;
