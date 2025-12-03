import { RunnerEngine } from "../engines/v1/RunnerEngine";

const engine = new RunnerEngine();

const intake = {
  triggers: ["authentication", "audit logging"]
};

try {
  const report = RunnerEngine.run(intake as any);
  console.log("=== REPORT ===");
  console.log(JSON.stringify(report, null, 2));
} catch (err) {
  console.error("RUNTIME ERROR:", err);
}
