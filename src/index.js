"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var sampleInput_json_1 = require("../sampleInput.json");
var RunnerEngine_1 = require("../engines/RunnerEngine");
var engine = new RunnerEngine_1.RunnerEngine();
var result = engine.run(sampleInput_json_1.default);
console.log(JSON.stringify(result, null, 2));
