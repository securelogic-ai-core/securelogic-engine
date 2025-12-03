import { RunnerEngine } from "../engines/v2/RunnerEngine";

const intake = {
  triggers: ["authentication", "audit logging"]
};

try {
  const result = RunnerEngine.execute(intake as any);
  console.log("=== V2 PIPELINE OUTPUT ===");
  console.log(JSON.stringify(result, null, 2));
} catch (err) {
  console.error("PIPELINE ERROR:", err);
}
