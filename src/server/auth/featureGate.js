"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasFeature = hasFeature;
var FEATURE_MATRIX = {
    FREE: [],
    PRO: ["RISK_SCORING", "MATERIAL_RISKS"],
    ENTERPRISE: ["RISK_SCORING", "MATERIAL_RISKS", "PDF_EXPORT"]
};
function hasFeature(license, feature) {
    var _a, _b;
    return (_b = (_a = FEATURE_MATRIX[license]) === null || _a === void 0 ? void 0 : _a.includes(feature)) !== null && _b !== void 0 ? _b : false;
}
