"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleRequest = handleRequest;
const runEngine_1 = require("../runEngine");
function handleRequest(scoringInput) {
    return (0, runEngine_1.runEngine)(scoringInput);
}
