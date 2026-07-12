/**
 * decisionRiskSingleDefinition.test.ts — the decision→own-risk map exists ONCE.
 *
 * THE DEFECT THIS GUARDS. `assetOwnRisk.ts` kept a private copy of DECISION_RISK
 * with values identical to the canonical map in `riskDimensionData.ts`. Identical
 * is not the same as shared: two copies of a scoring rule are two rules that merely
 * agree for now, and the day someone retunes `affected: 90` they will retune one of
 * them. The graph's own-risk and the registry rollup's own-risk are the same number
 * BY DEFINITION, so they must be the same constant.
 *
 * The guard matches on VALUES, not on the name. A copy called SEVERITY_WEIGHTS or
 * inlined into a switch is the same defect wearing a different label, and a
 * name-based check would wave it through.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Deliberately NOT importing riskDimensionData: it pulls in the pg pool, and a
// static structural guard must not need a database to tell you the source is wrong.
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The file allowed to define the map. */
const CANONICAL = path.join("api", "lib", "riskDimensionData.ts");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "dist" || entry === "_frozen_prod") continue;
      walk(full, out);
    } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * The map's fingerprint: the two decision keys whose weights actually carry the
 * scoring. Any re-declaration of the rule has to restate them, whatever it calls
 * itself — so this catches a renamed or inlined copy, not just a literal one.
 */
const FINGERPRINT = [/\baffected\s*:\s*90\b/, /\bpotentially_affected\s*:\s*60\b/];

describe("DECISION_RISK has exactly one definition", () => {
  it("no file outside riskDimensionData.ts re-declares the decision→risk weights", () => {
    const offenders = walk(SRC)
      .filter((f) => !f.includes("__tests__") && !f.includes(path.join("api", "tests")))
      .filter((f) => {
        const src = readFileSync(f, "utf8");
        return FINGERPRINT.every((re) => re.test(src));
      })
      .map((f) => path.relative(SRC, f));

    // Exactly one — the canonical module. If this fails, a second scoring rule has
    // appeared: import DECISION_RISK from riskDimensionData.ts instead of restating it.
    expect(offenders).toEqual([CANONICAL]);
  });

  it("the canonical map still holds the weights every own-risk score is built from", () => {
    // Pins the values themselves, so a silent retune has to be deliberate and visible
    // in a diff — the map is a scoring rule, not an implementation detail.
    const src = readFileSync(path.join(SRC, CANONICAL), "utf8");
    const body = src.slice(src.indexOf("export const DECISION_RISK"));
    for (const [decision, weight] of Object.entries({
      affected: 90,
      potentially_affected: 60,
      needs_review: 40,
      not_affected: 0,
      unknown: 0,
    })) {
      expect(body).toMatch(new RegExp(`\\b${decision}\\s*:\\s*${weight}\\b`));
    }
  });

  it("assetOwnRisk.ts consumes the canonical map rather than restating it", () => {
    const src = readFileSync(path.join(SRC, "api", "lib", "assetOwnRisk.ts"), "utf8");
    expect(src).toMatch(/import\s*\{[^}]*DECISION_RISK[^}]*\}\s*from\s*["'].*riskDimensionData\.js["']/);
    expect(src).not.toMatch(/const\s+DECISION_RISK\s*[:=]/);
  });
});
