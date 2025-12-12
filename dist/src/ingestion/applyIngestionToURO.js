"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyIngestionToURO = applyIngestionToURO;
const ingestionEngine_1 = require("./ingestionEngine");
function applyIngestionToURO(uro) {
    if (!uro.documents || uro.documents.length === 0) {
        uro.signals = {
            missingPolicies: [],
            foundControls: [],
            riskIndicators: []
        };
        return uro;
    }
    const signals = ingestionEngine_1.IngestionEngine.processAll(uro.documents);
    uro.signals = signals;
    return uro;
}
