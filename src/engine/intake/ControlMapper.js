"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ControlMapper = void 0;
var ControlMapper = /** @class */ (function () {
    function ControlMapper() {
    }
    ControlMapper.toScoringInput = function (q) {
        var _a;
        return {
            orgProfile: q.orgProfile,
            controlState: q.controls,
            assessments: (_a = q.assessments) !== null && _a !== void 0 ? _a : {}
        };
    };
    return ControlMapper;
}());
exports.ControlMapper = ControlMapper;
