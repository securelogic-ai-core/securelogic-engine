import { RunnerEngine } from "../engine/RunnerEngine.js";
import { ControlStateFactory } from "../engine/factories/ControlStateFactory.js";
import type { ScoringInput } from "../engine/contracts/ScoringInput.js";

const input: ScoringInput = {
  orgProfile: {
    industry: "Finance",
    size: "Enterprise",
    aiUsage: ["Fraud Detection"],
    modelTypes: ["ML"]
  },

  assessments: {},

  controlState: ControlStateFactory.create({
    governance: {
      aiGovernancePolicy: true,
      riskOwnerAssigned: true,
      rolesDefined: false,
      oversightCommittee: false,
      governanceWorkflow: false
    }
  })
};

const result = RunnerEngine.run(input);
console.log(JSON.stringify(result, null, 2));
