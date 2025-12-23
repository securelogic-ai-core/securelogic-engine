"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.IngestionEngine = void 0;
var policyExtractor_1 = require("./policyExtractor");
var controlDetector_1 = require("./controlDetector");
var riskIndicatorMapper_1 = require("./riskIndicatorMapper");
var IngestionEngine = /** @class */ (function () {
    function IngestionEngine() {
    }
    IngestionEngine.processDocument = function (text) {
        var _a = policyExtractor_1.PolicyExtractor.extract(text), found = _a.found, missing = _a.missing;
        var controls = controlDetector_1.ControlDetector.detect(text);
        var risks = riskIndicatorMapper_1.RiskIndicatorMapper.map(text);
        return {
            missingPolicies: missing,
            foundControls: controls,
            riskIndicators: risks
        };
    };
    IngestionEngine.processAll = function (documents) {
        var aggregate = {
            missingPolicies: new Set(),
            foundControls: new Set(),
            riskIndicators: new Set()
        };
        for (var _i = 0, documents_1 = documents; _i < documents_1.length; _i++) {
            var doc = documents_1[_i];
            if (!doc.extractedText)
                continue;
            var signals = this.processDocument(doc.extractedText);
            signals.missingPolicies.forEach(function (p) { return aggregate.missingPolicies.add(p); });
            signals.foundControls.forEach(function (c) { return aggregate.foundControls.add(c); });
            signals.riskIndicators.forEach(function (r) { return aggregate.riskIndicators.add(r); });
        }
        return {
            missingPolicies: Array.from(aggregate.missingPolicies),
            foundControls: Array.from(aggregate.foundControls),
            riskIndicators: Array.from(aggregate.riskIndicators)
        };
    };
    return IngestionEngine;
}());
exports.IngestionEngine = IngestionEngine;
