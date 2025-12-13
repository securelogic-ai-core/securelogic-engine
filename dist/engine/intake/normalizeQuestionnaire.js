"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeQuestionnaire = normalizeQuestionnaire;
function normalizeQuestionnaire(parsed) {
    return {
        orgProfile: parsed.data.orgProfile,
        controls: parsed.data.controls,
        assessments: {}
    };
}
