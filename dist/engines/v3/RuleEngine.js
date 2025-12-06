"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class RuleEngine {
    constructor(rules) {
        this.rules = rules;
    }
    evaluate(control, intake) {
        let results = [];
        for (const rule of this.rules) {
            const ruleResults = rule.evaluate(control, intake);
            results = results.concat(ruleResults);
        }
        return results;
    }
}
exports.default = RuleEngine;
