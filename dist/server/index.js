"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const dotenv_1 = __importDefault(require("dotenv"));
const RunnerEngine_1 = require("../engines/v2/RunnerEngine");
const validateInput_1 = require("../validation/validateInput");
const securelogic_full_json_1 = __importDefault(require("../frameworks/catalog/securelogic_full.json"));
dotenv_1.default.config();
const PORT = process.env.PORT || 4000;
const API_KEY = process.env.API_KEY;
const app = (0, express_1.default)();
app.use(express_1.default.json());
// ---- API KEY MIDDLEWARE ----
app.use((req, res, next) => {
    if (!API_KEY) {
        return res.status(500).json({ error: "Server missing API key" });
    }
    const headerKey = req.headers["x-api-key"];
    if (headerKey !== API_KEY) {
        return res.status(401).json({ error: "Unauthorized: Invalid API Key" });
    }
    next();
});
// ---- HEALTH CHECK ----
app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "SecureLogic Engine API" });
});
// ---- ASSESS ----
app.post("/assess", (req, res) => {
    try {
        (0, validateInput_1.validateInput)(req.body);
        const result = RunnerEngine_1.RunnerEngine.run(req.body, securelogic_full_json_1.default);
        res.json(result);
    }
    catch (err) {
        res.status(400).json({ error: err.message });
    }
});
// ---- START SERVER ----
app.listen(PORT, () => {
    console.log(`SecureLogic API running at http://localhost:${PORT}`);
});
