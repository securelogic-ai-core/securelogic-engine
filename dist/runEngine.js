"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runEngine = runEngine;
const RunnerEngine_1 = require("./engines/v2/RunnerEngine");
function runEngine(input) {
    return RunnerEngine_1.RunnerEngine.run(input);
}
