/**
 * scriptsParse.test.ts — every file under scripts/ must at least PARSE.
 *
 * Born from a staging outage (2026-08-17): a mechanical edit to
 * scripts/runMigrations.ts landed a syntax error inside a multi-line import.
 * Nothing caught it — `tsconfig.prod.json` excludes scripts/, no test imports
 * the script entrypoints (the migration-order test imports the runner CORE),
 * and the first thing to execute the file was the staging engine's
 * `npm run migrate && npm start`, which failed the deploy.
 *
 * This is deliberately a PARSE gate, not a typecheck: scripts are operator
 * tooling with looser typing, and a full typecheck would demand cleanup far
 * beyond the defect class this guards against. esbuild.transform is the same
 * transform tsx applies at execution, so "this test passes" means "tsx will
 * not die at parse time" — the exact failure mode that took the deploy down.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsFilesUnder(p));
    else if (name.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("scripts/ parse gate", () => {
  const files = tsFilesUnder(join(ROOT, "scripts"));

  it("finds the scripts (guard against a silently-empty sweep)", () => {
    expect(files.length).toBeGreaterThanOrEqual(30);
  });

  for (const f of files) {
    it(`parses: ${f.slice(ROOT.length + 1)}`, () => {
      const src = readFileSync(f, "utf8");
      // Throws on any syntax error — the same failure tsx would produce.
      transformSync(src, { loader: "ts", format: "esm", target: "node20" });
    });
  }
});
