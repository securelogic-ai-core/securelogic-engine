import { RunnerEngine } from "./src/engines/v2/RunnerEngine";
import { NormalizedIntake } from "./src/types/v2/Intake";
import { RawFrameworkControl } from "./src/types/v2/Control";

// 1. VALID intake matching your schema
const intake: NormalizedIntake = {
  size: "small",
  triggers: ["policy"],
  frameworks: [],
  domains: [],
  controlIds: []
};

// 2. VALID catalog controls
const catalog: RawFrameworkControl[] = [
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
const result = RunnerEngine.run(intake, catalog);

console.log(JSON.stringify(result, null, 2));
