"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadRiskConfig = loadRiskConfig;
var fs_1 = require("fs");
var path_1 = require("path");
function loadRiskConfig() {
    var configPath = path_1.default.join(__dirname, "../../config/riskMultipliers.json");
    try {
        var raw = fs_1.default.readFileSync(configPath, "utf8");
        return JSON.parse(raw);
    }
    catch (err) {
        console.warn("⚠️ Failed to load risk configuration. Using defaults.");
        return {
            multipliers: {
                missingPoliciesLikelihood: 0.1,
                missingPoliciesMax: 0.3,
                riskIndicatorsImpact: 0.2,
                riskIndicatorsMax: 0.4,
                foundControlsLikelihoodReduction: 0.05,
                foundControlsReductionMax: 0.2
            },
            version: "default"
        };
    }
}
