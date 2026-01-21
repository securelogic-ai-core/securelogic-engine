import { RunnerEngine } from "./dist/index.js";

const engine = new RunnerEngine();

await engine.run({
  client: {
    name: "Somnia Anesthesia",
    industry: "Healthcare",
    assessmentType: "AI Audit Sprint",
    scope: "Clinical + Administrative AI Usage"
  },
  context: {
    regulated: true,
    safetyCritical: true,
    handlesPII: true,
    scale: "Enterprise"
  },
  answers: {
    "AI-GOV-1": false
  }
});

console.log("Ledger valid:", engine.verifyLedger());
