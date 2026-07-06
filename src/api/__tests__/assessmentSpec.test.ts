/**
 * assessmentSpec.test.ts — EAR P10 (EAR-AD-5): the AssessmentTypeSpec
 * registry is the single source of truth for assessment lifecycles.
 *
 * 1. LOCKSTEP — the five delegated legacy validation modules re-export
 *    exactly the spec's data, and the spec's data equals the HISTORICAL
 *    literals (frozen here). If either side drifts, this fails.
 * 2. INTEGRITY — every spec row is internally consistent.
 * 3. MIGRATION LOCKSTEP — the 20260810 CHECK constraints carry exactly the
 *    asset spec's vocabulary and the new source_type values.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

import {
  ASSESSMENT_TYPE_SPECS,
  specTransitionAllowed
} from "../lib/assessmentSpec.js";
import {
  TERMINAL_STATUSES as OBLIGATION_TERMINAL,
  FINDING_STATUSES as OBLIGATION_FINDING,
  VALID_TRANSITIONS as OBLIGATION_TRANSITIONS,
  isValidTransition as obligationIsValidTransition
} from "../lib/obligationAssessmentValidation.js";
import {
  TERMINAL_STATUSES as VENDOR_REVIEW_TERMINAL,
  FINDING_STATUSES as VENDOR_REVIEW_FINDING,
  VALID_TRANSITIONS as VENDOR_REVIEW_TRANSITIONS
} from "../lib/vendorReviewValidation.js";
import { FINDING_STATUSES as CONTROL_FINDING } from "../lib/controlAssessmentValidation.js";
import { FINDING_STATUSES as AI_GOV_FINDING } from "../lib/aiGovernanceAssessmentValidation.js";
import { FINDING_STATUSES as DEPENDENCY_FINDING } from "../lib/dependencyReviewValidation.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The historical literals the legacy modules shipped with (pre-delegation).
 * The spec must stay byte-identical to these — they are the compat contract. */
const HISTORICAL = {
  control: {
    statuses: ["not_started", "in_progress", "passed", "failed", "remediation_required"],
    finding: ["failed", "remediation_required"]
  },
  obligation: {
    statuses: ["not_started", "in_progress", "compliant", "non_compliant", "partially_compliant"],
    terminal: ["compliant", "non_compliant", "partially_compliant"],
    finding: ["non_compliant", "partially_compliant"]
  },
  ai_governance: {
    statuses: ["not_started", "in_progress", "compliant", "non_compliant", "partially_compliant"],
    finding: ["non_compliant", "partially_compliant"]
  },
  dependency: {
    statuses: ["not_started", "in_progress", "acceptable", "flagged", "needs_remediation"],
    finding: ["flagged", "needs_remediation"]
  },
  vendor_review: {
    statuses: ["not_started", "in_progress", "satisfactory", "concerns_identified", "critical_issues"],
    terminal: ["satisfactory", "concerns_identified", "critical_issues"],
    finding: ["concerns_identified", "critical_issues"]
  }
} as const;

describe("spec ↔ historical literals (compat contract)", () => {
  it.each(Object.entries(HISTORICAL))("%s spec equals the frozen literals", (key, h) => {
    const spec = ASSESSMENT_TYPE_SPECS[key as keyof typeof ASSESSMENT_TYPE_SPECS];
    expect([...spec.statuses].sort()).toEqual([...h.statuses].sort());
    expect([...spec.findingStatuses].sort()).toEqual([...h.finding].sort());
    if ("terminal" in h) {
      expect([...(spec.terminalStatuses ?? [])].sort()).toEqual([...h.terminal].sort());
    } else {
      expect(spec.terminalStatuses).toBeNull();
    }
  });

  it("obligation transition graph is the frozen literal", () => {
    expect(ASSESSMENT_TYPE_SPECS.obligation.transitions).toEqual({
      not_started: ["in_progress"],
      in_progress: ["compliant", "non_compliant", "partially_compliant"],
      compliant: [],
      non_compliant: [],
      partially_compliant: []
    });
  });

  it("vendor_review transition graph is the frozen literal", () => {
    expect(ASSESSMENT_TYPE_SPECS.vendor_review.transitions).toEqual({
      not_started: ["in_progress"],
      in_progress: ["satisfactory", "concerns_identified", "critical_issues"],
      satisfactory: [],
      concerns_identified: [],
      critical_issues: []
    });
  });
});

describe("legacy module delegation (referential lockstep)", () => {
  it("obligation module re-exports the spec objects", () => {
    const spec = ASSESSMENT_TYPE_SPECS.obligation;
    expect(OBLIGATION_TERMINAL).toBe(spec.terminalStatuses);
    expect(OBLIGATION_FINDING).toBe(spec.findingStatuses);
    expect(OBLIGATION_TRANSITIONS).toBe(spec.transitions);
    expect(obligationIsValidTransition("not_started", "in_progress")).toBe(true);
    expect(obligationIsValidTransition("compliant", "in_progress")).toBe(false);
  });

  it("vendor_review module re-exports the spec objects", () => {
    const spec = ASSESSMENT_TYPE_SPECS.vendor_review;
    expect(VENDOR_REVIEW_TERMINAL).toBe(spec.terminalStatuses);
    expect(VENDOR_REVIEW_FINDING).toBe(spec.findingStatuses);
    expect(VENDOR_REVIEW_TRANSITIONS).toBe(spec.transitions);
  });

  it("control / ai_governance / dependency modules re-export the spec sets", () => {
    expect(CONTROL_FINDING).toBe(ASSESSMENT_TYPE_SPECS.control.findingStatuses);
    expect(AI_GOV_FINDING).toBe(ASSESSMENT_TYPE_SPECS.ai_governance.findingStatuses);
    expect(DEPENDENCY_FINDING).toBe(ASSESSMENT_TYPE_SPECS.dependency.findingStatuses);
  });
});

describe("spec integrity", () => {
  const rows = Object.values(ASSESSMENT_TYPE_SPECS);

  it("has exactly the eight known assessment types", () => {
    expect(rows.map((r) => r.key).sort()).toEqual([
      "ai_governance", "asset", "control", "dependency",
      "governance_review", "obligation", "vendor_assessment", "vendor_review"
    ]);
  });

  it("finding + terminal sets and transition keys are subsets of the vocabulary", () => {
    for (const spec of rows) {
      for (const s of spec.findingStatuses) {
        expect(spec.statuses.has(s), `${spec.key}: finding ${s}`).toBe(true);
      }
      for (const s of spec.terminalStatuses ?? []) {
        expect(spec.statuses.has(s), `${spec.key}: terminal ${s}`).toBe(true);
      }
      if (spec.transitions) {
        expect(Object.keys(spec.transitions).sort()).toEqual([...spec.statuses].sort());
        for (const targets of Object.values(spec.transitions)) {
          for (const t of targets) {
            expect(spec.statuses.has(t), `${spec.key}: target ${t}`).toBe(true);
          }
        }
      }
    }
  });

  it("immutableAtPost stacks have no transition graph (no PATCH exists)", () => {
    for (const spec of rows.filter((r) => r.immutableAtPost)) {
      expect(spec.transitions).toBeNull();
    }
  });

  it("findingSourceType values are unique (finding provenance is unambiguous)", () => {
    const types = rows.map((r) => r.findingSourceType);
    expect(new Set(types).size).toBe(types.length);
  });

  it("null transition graph preserves free transitions; explicit graph restricts", () => {
    const control = ASSESSMENT_TYPE_SPECS.control;
    expect(specTransitionAllowed(control, "passed", "in_progress")).toBe(true);
    expect(specTransitionAllowed(control, "passed", "nonsense")).toBe(false);

    const obligation = ASSESSMENT_TYPE_SPECS.obligation;
    expect(specTransitionAllowed(obligation, "compliant", "in_progress")).toBe(false);
    expect(specTransitionAllowed(obligation, "in_progress", "compliant")).toBe(true);
  });
});

describe("migration lockstep (20260810)", () => {
  const sql = readFileSync(
    path.resolve(HERE, "../../../db/migrations/20260810_asset_assessments.sql"),
    "utf8"
  );

  it("the table CHECK carries exactly the asset spec's status vocabulary", () => {
    for (const s of ASSESSMENT_TYPE_SPECS.asset.statuses) {
      expect(sql).toContain(`'${s}'`);
    }
  });

  it("findings + evidence CHECKs gain the asset spec's source_type", () => {
    const st = ASSESSMENT_TYPE_SPECS.asset.findingSourceType;
    for (const table of ["findings", "evidence"]) {
      const block = sql.split(`ALTER TABLE ${table}\n  ADD CONSTRAINT`)[1]?.split(";")[0] ?? "";
      expect(block, table).toContain(`'${st}'`);
    }
  });

  it("the table matches the spec's physical name and enables RLS", () => {
    expect(sql).toContain(`CREATE TABLE IF NOT EXISTS ${ASSESSMENT_TYPE_SPECS.asset.table}`);
    expect(sql).toContain(`ALTER TABLE ${ASSESSMENT_TYPE_SPECS.asset.table} ENABLE ROW LEVEL SECURITY`);
  });
});
