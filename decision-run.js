import fs from "fs";
import { RunnerEngine } from "./dist/engine/RunnerEngine.js";

if (process.argv.length < 3) {
  console.error("Usage: node decision-run.js <input.json>");
  process.exit(1);
}

const inputPath = process.argv[2];
const input = JSON.parse(fs.readFileSync(inputPath, "utf-8"));

const engine = new RunnerEngine();
const result = await engine.run(input);

// We freeze ONLY the decision object
console.log(JSON.stringify(result.decision, null, 2));
