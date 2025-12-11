"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const body_parser_1 = __importDefault(require("body-parser"));
const RunnerEngine_1 = require("../engines/v2/RunnerEngine");
const normalizeQuestionnaire_1 = require("../engine/intake/normalizeQuestionnaire");
const mapToScoringInput_1 = require("../engine/intake/mapToScoringInput");
const apiKey_1 = require("./middleware/apiKey");
const PORT = 4000;
const app = (0, express_1.default)();
app.use(body_parser_1.default.json());
app.use("/api", apiKey_1.requireApiKey);
app.post("/api/score", (req, res) => {
    try {
        const questionnaire = (0, normalizeQuestionnaire_1.normalizeQuestionnaire)(req.body);
        const scoringInput = (0, mapToScoringInput_1.mapToScoringInput)(questionnaire);
        const result = RunnerEngine_1.RunnerEngine.run(scoringInput);
        return res.json({ ok: true, engineResult: result });
    }
    catch (err) {
        return res.status(400).json({ ok: false, error: err.message });
    }
});
app.listen(PORT, () => {
    console.log(`SecureLogic AI Engine running on port ${PORT}`);
});
