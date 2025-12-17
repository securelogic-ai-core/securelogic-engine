"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ControlMapper = void 0;
class ControlMapper {
    static toScoringInput(q) {
        return {
            orgProfile: q.orgProfile,
            controlState: q.controls,
            assessments: q.assessments ?? {}
        };
    }
}
exports.ControlMapper = ControlMapper;
