import fs from "fs";
import { ControlRegistry } from "../src/engine/registry/ControlRegistry.js";

const answers: Record<string, boolean> = {};

// Flatten all controls from all frameworks
const allControls = Object.values(ControlRegistry.byFramework).flat();

// Alternate true/false for realism
let toggle = true;

for (const control of allControls) {
  answers[control.id] = toggle;
  toggle = !toggle;
}

const input = {
  client: {
    name: "Sample Corp",
    id: "sample-corp-001"
  },
  context: {
    regulated: true,
    handlesPII: true,
    safetyCritical: false,
    scale: "Enterprise"
  },
  answers
};

fs.writeFileSync(
  "engine-input.sample.json",
  JSON.stringify(input, null, 2)
);

console.log("✅ Wrote engine-input.sample.json");
