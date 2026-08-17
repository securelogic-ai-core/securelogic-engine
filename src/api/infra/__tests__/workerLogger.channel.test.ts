/**
 * workerLogger.channel.test.ts — pins the M-1 channel disposition that the
 * 2026-08-17 staging activation proved the hard way: `worker_runs` is Tier-D
 * owner-only, and this logger runs from worker RUNNERS outside any tenant
 * scope, so every site must be on the elevated channel. A regression to
 * ambient `pg` compiles and works under the owner credential but kills worker
 * scheduler startup with 42501 under `app_request`.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const SRC = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../workerLogger.ts"),
  "utf8"
);

describe("workerLogger channel disposition (M-1)", () => {
  it("uses the elevated channel exclusively", () => {
    expect(SRC).toContain('import { pgElevated } from "./postgres.js"');
    expect(SRC, "ambient pg.query would 42501 under app_request").not.toMatch(/\bpg\.(query|connect)\b/);
  });
});
