"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CategoryMaterialityPolicy = void 0;
const MATERIALITY_THRESHOLDS = {
    Governance: 0.30,
    Monitoring: 0.25,
    "Business Continuity": 0.20
};
class CategoryMaterialityPolicy {
    static apply(summary) {
        if (summary.severity !== "High") {
            return summary;
        }
        const categoryScores = summary.categoryScores.map(category => {
            const threshold = MATERIALITY_THRESHOLDS[category.category];
            if (!threshold)
                return category;
            const share = category.score / summary.overallScore;
            if (share >= threshold) {
                return {
                    ...category,
                    severity: "High"
                };
            }
            return category;
        });
        return {
            ...summary,
            categoryScores
        };
    }
}
exports.CategoryMaterialityPolicy = CategoryMaterialityPolicy;
