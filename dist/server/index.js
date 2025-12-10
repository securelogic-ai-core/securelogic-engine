"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const body_parser_1 = __importDefault(require("body-parser"));
const ScoringEngine_1 = require("../engines/v2/ScoringEngine");
const scoreV3_1 = __importDefault(require("./routes/scoreV3"));
const app = (0, express_1.default)();
const apiKey_1 = require("./middleware/apiKey");
app.use(body_parser_1.default.json());
app.use("/api", apiKey_1.requireApiKey);
app.use("/api/score/v3", scoreV3_1.default);
// Public scoring endpoint
app.post("/api/score", (req, res) => {
    try {
        const { controls, intake } = req.body;
        const result = ScoringEngine_1.ScoringEngine.score(controls, intake);
        res.json({ ok: true, result });
    }
    catch (err) {
        res.status(400).json({ ok: false, error: err.message });
    }
});
// Health check
app.get("/", (_req, res) => {
    res.json({ service: "SecureLogic Engine", status: "ok" });
});
app.listen(4000, "0.0.0.0", () => {
    console.log("🔥 SecureLogic Engine API running on 0.0.0.0:4000");
});
// Health check
app.get("/", (_req, res) => {
    res.json({ service: "SecureLogic Engine", status: "ok" });
});
