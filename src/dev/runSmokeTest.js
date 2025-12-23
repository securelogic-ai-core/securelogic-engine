"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var RunnerEngine_1 = require("../engine/RunnerEngine");
var ControlStateFactory_1 = require("../engine/factories/ControlStateFactory");
var input = {
    orgProfile: {
        industry: "Finance",
        size: "Enterprise",
        aiUsage: ["Fraud Detection"],
        modelTypes: ["ML"]
    },
    assessments: {},
    controlState: ControlStateFactory_1.ControlStateFactory.create({
        governance: {
            aiGovernancePolicy: true,
            riskOwnerAssigned: true,
            rolesDefined: false,
            oversightCommittee: false,
            governanceWorkflow: false
        }
    })
};
var result = RunnerEngine_1.RunnerEngine.run(input);
console.log(JSON.stringify(result, null, 2));
