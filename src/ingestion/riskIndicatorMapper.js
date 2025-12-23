"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RiskIndicatorMapper = void 0;
var RiskIndicatorMapper = /** @class */ (function () {
    function RiskIndicatorMapper() {
    }
    RiskIndicatorMapper.map = function (text) {
        var lower = text.toLowerCase();
        var found = [];
        this.riskPatterns.forEach(function (p) {
            if (lower.includes(p.keyword)) {
                found.push(p.indicator);
            }
        });
        return found;
    };
    RiskIndicatorMapper.riskPatterns = [
        { keyword: "no formal policy", indicator: "Lack of formal documentation" },
        { keyword: "not monitored", indicator: "Monitoring gap" },
        { keyword: "no evidence", indicator: "Evidence missing" },
        { keyword: "manual process", indicator: "Automation gap" },
        { keyword: "pending remediation", indicator: "Open findings" }
    ];
    return RiskIndicatorMapper;
}());
exports.RiskIndicatorMapper = RiskIndicatorMapper;
