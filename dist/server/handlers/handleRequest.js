"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleRequest = handleRequest;
const RunnerEngine_1 = require("../../engine/RunnerEngine");
function handleRequest(input) {
    return RunnerEngine_1.RunnerEngine.run(input);
}
