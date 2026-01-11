import fs from "fs";
import path from "path";
import type { RiskContext } from "../RiskContext.js";

const DIR = "runs";
fs.mkdirSync(DIR, { recursive: true });

export function writeRiskContext(context: RiskContext) {
  fs.writeFileSync(
    path.join(DIR, `${context.contextId}.context.json`),
    JSON.stringify(context, null, 2)
  );
}
