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
Object.defineProperty(exports, "__esModule", { value: true });
exports.CategoryMaterialityPolicy = void 0;
var MATERIALITY_THRESHOLDS = {
    Governance: 0.30,
    Monitoring: 0.25,
    "Business Continuity": 0.20
};
var CategoryMaterialityPolicy = /** @class */ (function () {
    function CategoryMaterialityPolicy() {
    }
    CategoryMaterialityPolicy.apply = function (summary) {
        if (summary.severity !== "High") {
            return summary;
        }
        var categoryScores = summary.categoryScores.map(function (category) {
            var threshold = MATERIALITY_THRESHOLDS[category.category];
            if (!threshold)
                return category;
            var share = category.score / summary.overallScore;
            if (share >= threshold) {
                return __assign(__assign({}, category), { severity: "High" });
            }
            return category;
        });
        return __assign(__assign({}, summary), { categoryScores: categoryScores });
    };
    return CategoryMaterialityPolicy;
}());
exports.CategoryMaterialityPolicy = CategoryMaterialityPolicy;
