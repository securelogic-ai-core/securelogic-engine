"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const RunnerEngine_1 = require("../engine/RunnerEngine");
const ControlStateFactory_1 = require("../engine/factories/ControlStateFactory");
const input = {
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
const result = RunnerEngine_1.RunnerEngine.run(input);
console.log(JSON.stringify(result, null, 2));
