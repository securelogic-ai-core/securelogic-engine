/**
 * pgPoolConstructionGuard.test.ts — PLATFORM-R1 item R1-1 guard.
 *
 * The bounds in infra/pgPoolTuning.ts only protect pools that are built from
 * them. This source-shape test walks every service tree that runs long-lived
 * and asserts that (a) the only `new Pool(` sites live in infra/postgres.ts,
 * (b) each of those spreads `toPoolOptions(...)`, and (c) each is followed by
 * `attachPoolObservability(` so an idle-client error cannot crash the process.
 *
 * scripts/ is deliberately OUT of scope: those are one-shot processes
 * (migrations, seeds, rehearsals) whose pools end with the process.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(__dirname, "../../..");
const TREES = ["src", ...readdirSync(resolve(ROOT, "services")).map((s) => `services/${s}/src`)];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__" || name === "dist") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|mts|cts|js|mjs)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

const OWNER = "src/api/infra/postgres.ts";

/** Strip block and line comments so prose about `new Pool(` cannot trip the guard. */
function code(f: string): string {
  return readFileSync(f, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

describe("R1-1 — no pool bypasses the shared bounds", () => {
  const files = TREES.flatMap((t) => {
    const abs = resolve(ROOT, t);
    try {
      statSync(abs);
    } catch {
      return [];
    }
    return walk(abs);
  });

  it("scans a non-trivial tree", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("only infra/postgres.ts constructs a pg Pool", () => {
    const offenders = files
      .filter((f) => /\bnew\s+Pool\s*\(/.test(code(f)))
      .map((f) => relative(ROOT, f))
      .filter((f) => f !== OWNER);
    expect(offenders).toEqual([]);
  });

  it("every Pool in infra/postgres.ts is bounded and observed", () => {
    const src = code(resolve(ROOT, OWNER));
    const sites = src.match(/new\s+Pool\s*\(\{[\s\S]*?\}\)/g) ?? [];
    expect(sites.length).toBe(2); // app + elevated — the RLS/elevated split stays
    for (const site of sites) {
      expect(site).toMatch(/\.\.\.toPoolOptions\(/);
    }
    expect(src.match(/attachPoolObservability\((pool|pgElevated),/g)?.length).toBe(2);
  });
});
