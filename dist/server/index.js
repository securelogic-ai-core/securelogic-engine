"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const body_parser_1 = __importDefault(require("body-parser"));
const RunnerEngine_1 = require("../engines/v2/RunnerEngine");
const app = (0, express_1.default)();
/* ===== Core middleware ===== */
app.use(body_parser_1.default.json());
app.use("/api", require("./middleware/apiKey").requireApiKey);
app.use("/api", require("./middleware/rateLimit").apiRateLimiter);
/* ===== Routes ===== */
app.post("/api/score", (req, res) => {
    const engineResult = RunnerEngine_1.RunnerEngine.run(req.body);
    res.json({ ok: true, engineResult });
});
/* ===== Health ===== */
app.get("/", (_req, res) => {
    res.json({ service: "SecureLogic Engine", status: "ok" });
});
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`✅ SecureLogic Engine listening on port ${PORT}`);
});
exports.default = app;
