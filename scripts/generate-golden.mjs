import { RunnerEngine } from "../dist/engine/RunnerEngine.js";
import fs from "fs";

const input = JSON.parse(fs.readFileSync("src/engine/__contract_tests__/goldens/input.v1.json", "utf-8"));

const engine = new RunnerEngine();
const result = await engine.run(input);

fs.writeFileSync(
  "src/engine/__contract_tests__/goldens/output.v1.json",
  JSON.stringify(result, null, 2)
);

console.log("Golden output generated.");
