"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeQuestionnaire = normalizeQuestionnaire;
const QuestionnaireSchema_1 = require("../validators/QuestionnaireSchema");
function normalizeQuestionnaire(raw) {
    const parsed = QuestionnaireSchema_1.QuestionnaireSchema.safeParse(raw);
    if (!parsed.success) {
        throw new Error("Invalid questionnaire input: " +
            JSON.stringify(parsed.error.format(), null, 2));
    }
    return parsed.data;
}
