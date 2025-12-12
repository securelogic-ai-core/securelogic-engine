"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const ScoringEngine_1 = require("../../engines/v3/ScoringEngine");
const router = (0, express_1.Router)();
// Create engine instance once
const engine = new ScoringEngine_1.ScoringEngineV3();
router.post("/", (req, res) => {
    try {
        const { controls = [], intake = {} } = req.body;
        const result = engine.score(controls, intake);
        return res.json({ ok: true, result });
    }
    catch (err) {
        return res.status(500).json({
            ok: false,
            error: err.message ?? "Unknown V3 scoring error"
        });
    }
});
exports.default = router;
