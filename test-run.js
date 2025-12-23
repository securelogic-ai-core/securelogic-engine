"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var RunnerEngine_1 = require("./src/engines/v2/RunnerEngine");
// 1. VALID intake matching your schema
var intake = {
    size: "small",
    triggers: ["policy"],
    frameworks: [],
    domains: [],
    controlIds: []
};
// 2. VALID catalog controls
var catalog = [
    {
        id: "CTRL-1",
        domain: "Govern",
        title: "Policy Requirement",
        description: "The organization shall document a policy.",
        keywords: ["policy", "document"],
        triggerTags: ["policy"]
    },
    {
        id: "CTRL-2",
        domain: "Map",
        title: "System Inventory",
        description: "A complete inventory of systems shall be maintained.",
        keywords: ["inventory"],
        triggerTags: ["asset"]
    }
];
// 3. Run the engine with 2 arguments
var result = RunnerEngine_1.RunnerEngine.run(intake, catalog);
console.log(JSON.stringify(result, null, 2));
