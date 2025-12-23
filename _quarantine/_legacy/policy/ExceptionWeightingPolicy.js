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
exports.ExceptionWeightingPolicy = void 0;
var ExceptionWeightingPolicy = /** @class */ (function () {
    function ExceptionWeightingPolicy() {
    }
    ExceptionWeightingPolicy.apply = function (scores) {
        return scores.map(function (score) {
            var _a;
            var state = (_a = score.evidence) === null || _a === void 0 ? void 0 : _a.observedState;
            if (!state)
                return score;
            // Unmitigated + not accepted = exception
            if (state.implemented === false && state.riskAccepted === false) {
                var uplift = Math.max(score.totalRiskScore * 0.15, 1);
                return __assign(__assign({}, score), { totalRiskScore: Number((score.totalRiskScore + uplift).toFixed(2)), drivers: __spreadArray(__spreadArray([], score.drivers, true), ["Unmitigated control exception"], false) });
            }
            return score;
        });
    };
    return ExceptionWeightingPolicy;
}());
exports.ExceptionWeightingPolicy = ExceptionWeightingPolicy;
