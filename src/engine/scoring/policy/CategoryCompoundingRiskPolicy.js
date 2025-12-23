"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CategoryCompoundingRiskPolicy = void 0;
var COMPOUNDING_RULES = [
    {
        categories: ["Governance", "Monitoring"],
        minSeverity: "Moderate",
        escalateTo: "High",
        rationale: "Governance and Monitoring weaknesses compound systemic AI risk"
    },
    {
        categories: ["Governance", "Business Continuity"],
        minSeverity: "Moderate",
        escalateTo: "High",
        rationale: "Governance and resilience gaps create compounding operational risk"
    }
];
var CategoryCompoundingRiskPolicy = /** @class */ (function () {
    function CategoryCompoundingRiskPolicy() {
    }
    CategoryCompoundingRiskPolicy.apply = function (summary) {
        var _a;
        var categoryMap = new Map(summary.categoryScores.map(function (c) { return [c.category, c.severity]; }));
        var rationales = [];
        for (var _i = 0, COMPOUNDING_RULES_1 = COMPOUNDING_RULES; _i < COMPOUNDING_RULES_1.length; _i++) {
            var rule = COMPOUNDING_RULES_1[_i];
            var _b = rule.categories, a = _b[0], b = _b[1];
            var sevA = categoryMap.get(a);
            var sevB = categoryMap.get(b);
            if (!sevA || !sevB)
                continue;
            var qualifies = (sevA === "High" || sevA === rule.minSeverity) &&
                (sevB === "High" || sevB === rule.minSeverity);
            if (qualifies) {
                rationales.push(rule.rationale);
            }
        }
        if (rationales.length === 0) {
            return summary;
        }
        return __assign(__assign({}, summary), { severityRationale: __spreadArray(__spreadArray([], ((_a = summary.severityRationale) !== null && _a !== void 0 ? _a : []), true), rationales, true) });
    };
    return CategoryCompoundingRiskPolicy;
}());
exports.CategoryCompoundingRiskPolicy = CategoryCompoundingRiskPolicy;
