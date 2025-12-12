"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RiskIndicatorMapper = void 0;
class RiskIndicatorMapper {
    static map(text) {
        const lower = text.toLowerCase();
        const found = [];
        this.riskPatterns.forEach(p => {
            if (lower.includes(p.keyword)) {
                found.push(p.indicator);
            }
        });
        return found;
    }
}
exports.RiskIndicatorMapper = RiskIndicatorMapper;
RiskIndicatorMapper.riskPatterns = [
    { keyword: "no formal policy", indicator: "Lack of formal documentation" },
    { keyword: "not monitored", indicator: "Monitoring gap" },
    { keyword: "no evidence", indicator: "Evidence missing" },
    { keyword: "manual process", indicator: "Automation gap" },
    { keyword: "pending remediation", indicator: "Open findings" }
];
