/**
 * evidenceLifecycleContract.test.ts — ADR-0012 Step 2, the parts provable
 * without a database.
 *
 * Two jobs:
 *
 *  1. LOCKSTEP. Every vocabulary in evidenceLifecycleContract.ts is a mirror of
 *     a CHECK constraint in 20261080–82. The repository's closed-vocabulary
 *     pattern is TEXT + CHECK + a mirrored constant + a test that reads the SQL,
 *     chosen over a Postgres ENUM because an ENUM value cannot be removed or
 *     reordered without a type rewrite. This is that test — without it the
 *     mirror silently rots, which is the failure mode the pattern exists to
 *     prevent.
 *
 *  2. FAIL-CLOSED SHAPE. The counting predicate must not be able to count an
 *     artifact whose validity nobody established, and must not quietly
 *     auto-detach a superseded one. Both are asserted as text properties of the
 *     predicate here, and behaviourally against a real Postgres in
 *     test/isolation/evidenceLifecycle.test.ts.
 */

import { describe, it, expect } from "vitest";
import { execSync } from "child_process";
import { readFileSync } from "fs";
import { resolve } from "path";

import {
  EVIDENCE_VALIDITY_BASES,
  EVIDENCE_ASSURANCE_CLASSES,
  EVIDENCE_LINK_TARGET_TYPES,
  EVIDENCE_LINK_KINDS,
  EVIDENCE_DETACH_REASONS,
  EVIDENCE_LIFECYCLE_EVENT_TYPES,
  SQL_EVIDENCE_COUNTING,
  SQL_EVIDENCE_SUPERSEDED,
  SQL_EVIDENCE_EXPIRED,
} from "../lib/evidenceLifecycleContract";
import { evidenceLifecycleV2Enabled } from "../lib/evidenceLifecycleFlag";

const MIGRATIONS = resolve(__dirname, "../../../db/migrations");

function migration(file: string): string {
  return readFileSync(resolve(MIGRATIONS, file), "utf8");
}

/**
 * Pull the quoted values out of a named `... IN ( 'a', 'b' )` CHECK.
 * Comments inside the list are stripped first so an example in a `--` comment
 * can never be mistaken for a legal value.
 */
function checkVocabulary(sql: string, constraintName: string): string[] {
  const start = sql.indexOf(constraintName);
  if (start === -1) throw new Error(`constraint ${constraintName} not found`);
  const inIdx = sql.indexOf(" IN (", start);
  if (inIdx === -1) throw new Error(`constraint ${constraintName} has no IN list`);

  // Walk to the matching close paren of the IN list.
  let depth = 0;
  let end = -1;
  for (let i = inIdx + 4; i < sql.length; i++) {
    if (sql[i] === "(") depth++;
    else if (sql[i] === ")") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) throw new Error(`constraint ${constraintName} has an unbalanced IN list`);

  const body = sql
    .slice(inIdx, end)
    .split("\n")
    .map((line) => {
      const c = line.indexOf("--");
      return c === -1 ? line : line.slice(0, c);
    })
    .join("\n");

  return [...body.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
}

describe("closed vocabularies stay in lockstep with the migrations", () => {
  it("evidence.validity_basis", () => {
    const sql = migration("20261080_evidence_validity_and_supersession.sql");
    expect(checkVocabulary(sql, "evidence_validity_basis_check").sort())
      .toEqual([...EVIDENCE_VALIDITY_BASES].sort());
  });

  it("evidence.assurance_class", () => {
    const sql = migration("20261080_evidence_validity_and_supersession.sql");
    expect(checkVocabulary(sql, "evidence_assurance_class_check").sort())
      .toEqual([...EVIDENCE_ASSURANCE_CLASSES].sort());
  });

  it("evidence_links.target_type", () => {
    const sql = migration("20261081_evidence_links.sql");
    expect(checkVocabulary(sql, "evidence_links_target_type_check").sort())
      .toEqual([...EVIDENCE_LINK_TARGET_TYPES].sort());
  });

  it("evidence_links.link_kind", () => {
    const sql = migration("20261081_evidence_links.sql");
    expect(checkVocabulary(sql, "evidence_links_kind_check").sort())
      .toEqual([...EVIDENCE_LINK_KINDS].sort());
  });

  it("evidence_links.detach_reason", () => {
    const sql = migration("20261081_evidence_links.sql");
    expect(checkVocabulary(sql, "evidence_links_detach_reason_check").sort())
      .toEqual([...EVIDENCE_DETACH_REASONS].sort());
  });

  it("evidence_lifecycle_events.event_type", () => {
    const sql = migration("20261082_evidence_lifecycle_events.sql");
    expect(checkVocabulary(sql, "evidence_lifecycle_event_type_check").sort())
      .toEqual([...EVIDENCE_LIFECYCLE_EVENT_TYPES].sort());
  });
});

describe("the validity vocabulary carries no unratified policy", () => {
  it("has no 'policy_default' basis — Step 3 durations are NOT ratified", () => {
    // A value only a ratified policy could produce would imply a policy exists.
    // Step 3 adds it in its own migration, on the day it is approved.
    expect(EVIDENCE_VALIDITY_BASES).not.toContain("policy_default" as never);
  });

  it("'unclassified' is the assurance class every legacy row lands on", () => {
    expect(EVIDENCE_ASSURANCE_CLASSES[0]).toBe("unclassified");
  });

  it("separates SOC 2 Type I from Type II", () => {
    // A Type I attests DESIGN at a point in time and can never establish that a
    // control OPERATED. One shared class would let it stand in for a Type II.
    expect(EVIDENCE_ASSURANCE_CLASSES).toContain("soc2_type1");
    expect(EVIDENCE_ASSURANCE_CLASSES).toContain("soc2_type2");
  });

  it("separates a DPA from a sub-processor list", () => {
    // Two different artifacts with one name: a DPA can be valid for years while
    // its Annex is a year stale.
    expect(EVIDENCE_ASSURANCE_CLASSES).toContain("privacy_agreement");
    expect(EVIDENCE_ASSURANCE_CLASSES).toContain("subprocessor_list");
  });
});

describe("the counting predicate fails closed", () => {
  it("requires a live link", () => {
    expect(SQL_EVIDENCE_COUNTING).toContain("el.detached_at IS NULL");
  });

  it("requires a per-use human confirmation", () => {
    expect(SQL_EVIDENCE_COUNTING).toContain("el.confirmed_at IS NOT NULL");
  });

  it("refuses an artifact whose validity was never established", () => {
    expect(SQL_EVIDENCE_COUNTING).toContain("e.validity_basis <> 'not_established'");
  });

  it("does NOT read a NULL valid_until as valid", () => {
    // ADR-0012 §2.3 writes `valid_until IS NULL OR valid_until >= CURRENT_DATE`.
    // That reads "we never established this" and "this never expires" as the
    // same thing. The owner's 2026-09-01 fail-closed direction supersedes it:
    // only an explicit 'perpetual' basis counts without an end date.
    expect(SQL_EVIDENCE_COUNTING).not.toMatch(/valid_until IS NULL/);
    expect(SQL_EVIDENCE_COUNTING).toContain("e.validity_basis = 'perpetual'");
  });

  it("tests the date in the predicate, not only in a sweep worker", () => {
    expect(SQL_EVIDENCE_COUNTING).toContain("CURRENT_DATE");
  });

  it("does NOT exclude a superseded artifact — that would auto-detach it by arithmetic", () => {
    // ADR-0012 §2.4: open links to a superseded version are never auto-detached;
    // the surface NAMES "a newer version exists" and a human relinks.
    expect(SQL_EVIDENCE_COUNTING).not.toContain("supersedes_evidence_id");
    expect(SQL_EVIDENCE_SUPERSEDED).toContain("supersedes_evidence_id");
  });

  it("expiry means ran-out, not never-established", () => {
    expect(SQL_EVIDENCE_EXPIRED).toContain("e.validity_basis = 'artifact_dates'");
    expect(SQL_EVIDENCE_EXPIRED).toContain("valid_until < CURRENT_DATE");
  });
});

describe("the lifecycle flag is dark", () => {
  it("is off when unset", () => {
    expect(evidenceLifecycleV2Enabled({})).toBe(false);
  });

  it("is off for every value except the exact string 'true'", () => {
    for (const v of ["false", "TRUE", "1", "yes", "", " true"]) {
      expect(evidenceLifecycleV2Enabled({ SECURELOGIC_EVIDENCE_LIFECYCLE_V2: v })).toBe(false);
    }
    expect(evidenceLifecycleV2Enabled({ SECURELOGIC_EVIDENCE_LIFECYCLE_V2: "true" })).toBe(true);
  });
});

describe("nothing consumes the contract yet (Step 2 ships dark)", () => {
  it("is imported by no counting path", () => {
    // The moment this fails, someone has wired the predicate. That is a
    // deliberate act which needs its own package, a curation path for legacy
    // evidence, and a zero-divergence dual-read proof (ADR-0012 §5) — not a
    // quiet import. Update this test when that package lands.
    const out = execSync(
      "grep -rl 'evidenceLifecycleContract' src --include=*.ts || true",
      { encoding: "utf8" }
    )
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      // the module itself and this test are not consumers
      .filter((f) => !f.endsWith("lib/evidenceLifecycleContract.ts"))
      .filter((f) => !f.endsWith("__tests__/evidenceLifecycleContract.test.ts"));
    expect(out).toEqual([]);
  });
});
