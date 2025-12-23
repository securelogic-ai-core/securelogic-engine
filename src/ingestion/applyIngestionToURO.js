"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyIngestionToURO = applyIngestionToURO;
var ingestionEngine_1 = require("./ingestionEngine");
function applyIngestionToURO(uro) {
    if (!uro.documents || uro.documents.length === 0) {
        uro.signals = {
            missingPolicies: [],
            foundControls: [],
            riskIndicators: []
        };
        return uro;
    }
    var signals = ingestionEngine_1.IngestionEngine.processAll(uro.documents);
    uro.signals = signals;
    return uro;
}
