/**
 * regenerateGolden.ts — regenerate the locked golden `*.expected.json` files from
 * the current corpus. Run ONLY after an INTENTIONAL corpus change, review the diff,
 * and bump `engine_version`. This is a dev tool, not part of the served build.
 *
 *   node --import tsx src/engine/applicability/v1/__tests__/regenerateGolden.ts
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { ApplicabilityEngineV1 } from "../ApplicabilityEngineV1.js";
import type { ApplicabilityInput } from "../types.js";

const casesDir = fileURLToPath(new URL("./golden/cases/", import.meta.url));
const inputs = readdirSync(casesDir).filter((f) => f.endsWith(".input.json")).sort();

for (const inputFile of inputs) {
  const name = inputFile.replace(/\.input\.json$/, "");
  const input = JSON.parse(readFileSync(casesDir + inputFile, "utf8")) as ApplicabilityInput;
  const result = ApplicabilityEngineV1.assess(input);
  writeFileSync(casesDir + `${name}.expected.json`, JSON.stringify(result, null, 2) + "\n", "utf8");
  console.log(`regenerated ${name}.expected.json -> ${result.decision} (${result.confidence})`);
}
