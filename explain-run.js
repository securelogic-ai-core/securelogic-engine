import fs from "fs";
import { RunnerEngine } from "./dist/index.js";

// Load REAL engine input
const input = JSON.parse(fs.readFileSync("./engine-input.sample.json", "utf-8"));

// Run V1
const engineV1 = new RunnerEngine(undefined, "V1");
const resultV1 = await engineV1.run(input);

// Run V2
const engineV2 = new RunnerEngine(undefined, "V2");
const resultV2 = await engineV2.run(input);

// Write outputs
fs.writeFileSync("explained.v1.json", JSON.stringify(resultV1, null, 2));
fs.writeFileSync("explained.v2.json", JSON.stringify(resultV2, null, 2));

console.log("✅ Wrote explained.v1.json and explained.v2.json");
