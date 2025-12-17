"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadRiskConfig = loadRiskConfig;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
function loadRiskConfig() {
    const configPath = path_1.default.join(__dirname, "../../config/riskMultipliers.json");
    try {
        const raw = fs_1.default.readFileSync(configPath, "utf8");
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
