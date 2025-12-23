"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runEngine = runEngine;
var RunnerEngine_1 = require("./engine/RunnerEngine");
function runEngine(input) {
    console.log("🚨 USING PRIMARY RunnerEngine");
    return RunnerEngine_1.RunnerEngine.run(input);
}
