"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var RunnerEngine_1 = require("../engine/RunnerEngine");
var input = {
    email: "test@securelogic.ai",
    orgProfile: {
        industry: "Healthcare",
        size: "SMB",
        aiUsage: ["Decision Support"],
        modelTypes: ["ML"]
    },
    triggers: ["PHI", "Automated Decisions"]
};
var result = RunnerEngine_1.RunnerEngine.run(input);
console.log(result);
