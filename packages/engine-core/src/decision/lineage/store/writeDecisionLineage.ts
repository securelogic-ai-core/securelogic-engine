import fs from "fs";
import path from "path";
import type { DecisionLineage } from "../DecisionLineage.js";

const DIR = "decision-lineage";
fs.mkdirSync(DIR, { recursive: true });

export function writeDecisionLineage(lineage: DecisionLineage) {
  fs.writeFileSync(
    path.join(DIR, `${lineage.decisionId}.lineage.json`),
    JSON.stringify(lineage, null, 2)
  );
}
