"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const usage_1 = require("./telemetry/usage");
const body_parser_1 = __importDefault(require("body-parser"));
const ScoringEngine_1 = require("../engines/v2/ScoringEngine");
const app = (0, express_1.default)();
app.use((req, _res, next) => { console.log("HIT:", req.method, req.path); next(); });
/* ===== Core middleware ===== */
app.use(body_parser_1.default.json());
app.use("/api", require("./middleware/apiKey").requireApiKey);
app.use("/api", require("./middleware/rateLimit").apiRateLimiter);
/* ===== Routes ===== */
app.post("/api/score", (req, res) => {
    try {
        const { controls, intake } = req.body;
        const result = ScoringEngine_1.ScoringEngine.score(controls, intake);
        (0, usage_1.recordUsage)(req.apiKey ?? "anonymous", "/api/score");
        res.json({ ok: true, result });
    }
    catch (err) {
        res.status(400).json({ ok: false, error: err.message });
    }
});
/* ===== Health ===== */
app.get("/", (_req, res) => {
    res.json({ service: "SecureLogic Engine", status: "ok" });
});
/* ===== Internal usage inspection (admin only) ===== */
app.get("/internal/usage", (req, res) => {
    const adminKey = "ent123";
    if (req.header("x-api-key") !== adminKey) {
        return res.status(403).json({ ok: false });
    }
    const { getUsage } = require("./telemetry/usage");
    res.status(200).json({ ok: true, usage: getUsage() });
});
app.listen(4000, "0.0.0.0", () => {
    console.log("🔥 SecureLogic Engine API running on 0.0.0.0:4000");
});
/* ===== Internal usage inspection (admin only) ===== */
