import fs from "fs";
import { DecisionDiffEngine } from "./dist/engine/explain/DecisionDiffEngine.js";

if (process.argv.length < 4) {
  console.error("Usage: node diff-run.js <before.json> <after.json>");
  process.exit(1);
}

const beforePath = process.argv[2];
const afterPath = process.argv[3];

const before = JSON.parse(fs.readFileSync(beforePath, "utf-8"));
const after = JSON.parse(fs.readFileSync(afterPath, "utf-8"));

const diff = DecisionDiffEngine.diff(before, after);

console.log("=== SecureLogic Decision Diff ===");
console.log(JSON.stringify(diff, null, 2));
