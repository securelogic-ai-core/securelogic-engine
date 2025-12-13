"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapToScoringInput = mapToScoringInput;
const ControlMapper_1 = require("./ControlMapper");
function mapToScoringInput(q) {
    return ControlMapper_1.ControlMapper.toScoringInput(q);
}
