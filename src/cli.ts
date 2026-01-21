import * as fs from "node:fs";
import * as process from "node:process";
import { SecureLogicEngine } from "./engine/api/Engine.js";

function fail(msg: string): never {
  console.error("ERROR:", msg);
  process.exit(1);
}

const inputPath = process.argv[2];
if (!inputPath) {
  fail("Usage: node cli.js <input.json>");
}

if (!fs.existsSync(inputPath)) {
  fail(`Input file not found: ${inputPath}`);
}

let input: any;
try {
  input = JSON.parse(fs.readFileSync(inputPath, "utf-8"));
} catch {
  fail("Invalid JSON input file");
}

if (!input.context || !input.findings || !input.policyBundle) {
  fail("Input must contain: { context, findings, policyBundle }");
}

try {
  const result = SecureLogicEngine.runDecision(
    input.context,
    input.findings,
    input.policyBundle
  );

  console.log(JSON.stringify(result, null, 2));
} catch (e: any) {
  console.error("Execution failed:");
  console.error(e?.stack || e);
  process.exit(2);
}
