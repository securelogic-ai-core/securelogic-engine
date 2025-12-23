"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scoreControlState = scoreControlState;
/**
 * Scores control implementation completeness.
 * Deterministic, auditable, enterprise-safe.
 */
function scoreControlState(controlState) {
    var sections = Object.values(controlState);
    var total = 0;
    var implemented = 0;
    for (var _i = 0, sections_1 = sections; _i < sections_1.length; _i++) {
        var section = sections_1[_i];
        for (var _a = 0, _b = Object.values(section); _a < _b.length; _a++) {
            var value = _b[_a];
            total += 1;
            if (value === true)
                implemented += 1;
        }
    }
    if (total === 0)
        return 0;
    return Math.round((implemented / total) * 100);
}
