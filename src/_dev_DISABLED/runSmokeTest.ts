
import { RunnerEngine } from "../engine/RunnerEngine.js";
import type { AuditSprintInput } from "../engine/contracts/AuditSprintInput.js";

const input: AuditSprintInput = {
  email: "test@securelogic.ai",
  orgProfile: {
    industry: "Healthcare",
    size: "SMB",
    aiUsage: ["Decision Support"],
    modelTypes: ["ML"]
  },
  triggers: ["PHI", "Automated Decisions"]
};

const result = RunnerEngine.run(input);
console.log(result);
