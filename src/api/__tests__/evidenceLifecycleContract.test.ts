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
    // 20261080 introduced this constraint with three values; 20261083
    // REDEFINES it to add 'policy_default' once D1 was ratified. Read the
    // migration that owns the constraint now, or this test would assert a
    // vocabulary the database no longer has.
    const sql = migration("20261083_evidence_validity_policy.sql");
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
    // 20261082 introduced this constraint with seven values; 20261084
    // REDEFINES it to add 'withdrawn'. Read the migration that owns the
    // constraint now — same reason as validity_basis above.
    const sql = migration("20261084_evidence_governed_withdrawal.sql");
    expect(checkVocabulary(sql, "evidence_lifecycle_event_type_check").sort())
      .toEqual([...EVIDENCE_LIFECYCLE_EVENT_TYPES].sort());
  });
});

describe("the validity vocabulary tracks what is actually ratified", () => {
  it("HAS a 'policy_default' basis — D1 was ratified 2026-09-01", () => {
    // This assertion was the inverse until Step 3 landed: a value only a
    // ratified policy could produce would have implied a policy existed. D0,
    // D1, D15 and D16 were ratified on 2026-09-01 and 20261083 adds both the
    // value and the policy that produces it, so the vocabulary now carries it.
    expect(EVIDENCE_VALIDITY_BASES).toContain("policy_default" as never);
  });

  it("still carries NO value that would imply an unratified default", () => {
    // D2-D14 are not ratified. There is deliberately no 'policy_fallback',
    // 'default_ttl' or similar — a default for unknown artifacts would be a
    // universal TTL wearing a different name.
    for (const basis of EVIDENCE_VALIDITY_BASES) {
      expect(basis).not.toMatch(/fallback|ttl|catch_all/);
    }
    expect(EVIDENCE_VALIDITY_BASES).toHaveLength(4);
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

describe("the COUNTING PREDICATE is still not wired", () => {
  it("nothing outside this module imports SQL_EVIDENCE_COUNTING or SQL_EVIDENCE_SUPERSEDED", () => {
    // This guard was originally "nothing imports the module at all", because
    // Step 2 shipped with no writer whatsoever. The governed writer package has
    // now landed and legitimately imports the module's VOCABULARIES — target
    // types, link kinds, assurance classes. That is not the thing the guard
    // protects.
    //
    // What it protects is the PREDICATE. Wiring SQL_EVIDENCE_COUNTING into the
    // closure gate, the effectiveness ladder or posture is the act that changes
    // what counts as assured estate-wide, and it still needs its own package
    // and ADR-0012 §5's zero-divergence dual-read proof — not a quiet import.
    // So the guard now names the predicate rather than the file.
    const out = execSync(
      "grep -rlE 'SQL_EVIDENCE_(COUNTING|SUPERSEDED)' src --include=*.ts || true",
      { encoding: "utf8" }
    )
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((f) => !f.endsWith("lib/evidenceLifecycleContract.ts"))
      .filter((f) => !f.endsWith("__tests__/evidenceLifecycleContract.test.ts"));
    expect(out).toEqual([]);
  });

  it("the writer imports vocabularies only — never the predicate", () => {
    const writer = readFileSync(
      resolve(__dirname, "../lib/evidenceLinkWriter.ts"),
      "utf8"
    );
    expect(writer).toContain("evidenceLifecycleContract");
    expect(writer).not.toMatch(/SQL_EVIDENCE_(COUNTING|SUPERSEDED)/);
  });
});;
