"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IngestionEngine = void 0;
const policyExtractor_1 = require("./policyExtractor");
const controlDetector_1 = require("./controlDetector");
const riskIndicatorMapper_1 = require("./riskIndicatorMapper");
class IngestionEngine {
    static processDocument(text) {
        const { found, missing } = policyExtractor_1.PolicyExtractor.extract(text);
        const controls = controlDetector_1.ControlDetector.detect(text);
        const risks = riskIndicatorMapper_1.RiskIndicatorMapper.map(text);
        return {
            missingPolicies: missing,
            foundControls: controls,
            riskIndicators: risks
        };
    }
    static processAll(documents) {
        const aggregate = {
            missingPolicies: new Set(),
            foundControls: new Set(),
            riskIndicators: new Set()
        };
        for (const doc of documents) {
            if (!doc.extractedText)
                continue;
            const signals = this.processDocument(doc.extractedText);
            signals.missingPolicies.forEach(p => aggregate.missingPolicies.add(p));
            signals.foundControls.forEach(c => aggregate.foundControls.add(c));
            signals.riskIndicators.forEach(r => aggregate.riskIndicators.add(r));
        }
        return {
            missingPolicies: Array.from(aggregate.missingPolicies),
            foundControls: Array.from(aggregate.foundControls),
            riskIndicators: Array.from(aggregate.riskIndicators)
        };
    }
}
exports.IngestionEngine = IngestionEngine;
