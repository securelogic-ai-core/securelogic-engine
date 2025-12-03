import { RunnerEngine } from "../engines/v2/RunnerEngine";
import { RawIntakeSubmission } from "../types/v2/Intake";
import sampleInput from "./sampleInput.json";

async function main() {
  console.log("=== SecureLogic Engine Test Runner ===");

  const engine = RunnerEngine;

  const input: RawIntakeSubmission = sampleInput;

  try {
    const result = RunnerEngine.execute(input);

    console.log("\n=== FINAL REPORT OUTPUT ===\n");
    console.log(JSON.stringify(result, null, 2));

    console.log("\n=== Engine Run Complete ===");
  } catch (err: any) {
    console.error("ENGINE FAILED:", err.message || err);
  }
}

main();
