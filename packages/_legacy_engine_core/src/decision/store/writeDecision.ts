import fs from "fs";
import path from "path";
import type { Decision } from "../Decision.js";

const DIR = "decisions";
fs.mkdirSync(DIR, { recursive: true });

export function writeDecision(decision: Decision) {
  const file = path.join(DIR, `${decision.contextId}.decision.json`);
  fs.writeFileSync(file, JSON.stringify(decision, null, 2));
}
