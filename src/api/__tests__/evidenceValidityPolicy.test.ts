/**
 * VA-S4 step 3 — the evidence-validity policy contract.
 *
 * Proves the three ratified rules bind in the order the module documents, that
 * the vocabularies stay in lockstep with migration 20261083, and that the one
 * value D1 did NOT pin down (a Type I duration) resolves to no window rather
 * than to a guess.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

import {
  VALIDITY_ANCHORS,
  addMonths,
  resolveValidityWindow,
  isWindowCurrent,
  type ValidityPolicyRow,
} from "../lib/evidenceValidityPolicy";
import { EVIDENCE_VALIDITY_BASES } from "../lib/evidenceLifecycleContract";

const MIGRATION = readFileSync(
  resolve(__dirname, "../../../db/migrations/20261083_evidence_validity_policy.sql"),
  "utf8"
);

/** D2-D14, owner-ratified 2026-09-02. */
const MIGRATION_D2_D14 = readFileSync(
  resolve(__dirname, "../../../db/migrations/20261085_evidence_validity_policy_d2_d14.sql"),
  "utf8"
);

const SOC2_TYPE2: ValidityPolicyRow = {
  assuranceClass: "soc2_type2",
  defaultDurationMonths: 12,
  maxDurationMonths: 15,
  minDurationMonths: 3,
  anchor: "report_period_end",
  requiresArtifactEnd: false,
  artifactBasisPermitted: false,
  bridgeRequiredAboveMonths: null,
  noWindowReason: null,
};

/** D1 ratified "its own rule" and named no number. */
const SOC2_TYPE1: ValidityPolicyRow = {
  assuranceClass: "soc2_type1",
  defaultDurationMonths: null,
  maxDurationMonths: null,
  minDurationMonths: null,
  anchor: "none",
  requiresArtifactEnd: false,
  artifactBasisPermitted: false,
  bridgeRequiredAboveMonths: null,
  noWindowReason: "type_i_attests_design_only",
};

/** D1 as AMENDED by D2: the 15-month ceiling stays, months 13-15 go conditional. */
const SOC2_TYPE2_D2: ValidityPolicyRow = {
  ...SOC2_TYPE2,
  bridgeRequiredAboveMonths: 12,
};

/** D3 + D4: the certificate's stated expiry is required, not merely a cap. */
const ISO_CERT: ValidityPolicyRow = {
  assuranceClass: "iso_certification",
  defaultDurationMonths: 12,
  maxDurationMonths: 36,
  minDurationMonths: 3,
  anchor: "artifact_stated_date",
  requiresArtifactEnd: true,
  artifactBasisPermitted: false,
  bridgeRequiredAboveMonths: null,
  noWindowReason: null,
};

/** D10: the 24 is an absolute CEILING, never a fallback window. */
const VENDOR_ATTESTATION: ValidityPolicyRow = {
  assuranceClass: "vendor_attestation",
  defaultDurationMonths: 24,
  maxDurationMonths: 24,
  minDurationMonths: 1,
  anchor: "object_cadence",
  requiresArtifactEnd: false,
  artifactBasisPermitted: false,
  bridgeRequiredAboveMonths: null,
  noWindowReason: null,
};

describe("lockstep with migration 20261083", () => {
  it("the ORIGINAL anchor vocabulary is a subset of today's, minus the renamed one", () => {
    // 20261085 renamed artifact_term -> artifact_stated_date (free: nothing
    // used it) and added object_cadence. The live lockstep therefore belongs to
    // 20261085; what 20261083 still owes is that it introduced nothing this
    // module has since dropped.
    const m = MIGRATION.match(/anchor IN \(([^)]*)\)/);
    expect(m).not.toBeNull();
    const inSql = [...m![1].matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1]);
    const survivors = inSql.filter((a) => a !== "artifact_term");
    for (const a of survivors) expect(VALIDITY_ANCHORS).toContain(a as never);
    expect(inSql).toContain("artifact_term");
  });

  it("'policy_default' is a legal validity_basis", () => {
    expect(EVIDENCE_VALIDITY_BASES).toContain("policy_default");
    expect(MIGRATION).toContain("'policy_default'");
  });

  it("seeds ONLY the D1 classes — no speculative durations", () => {
    const insert = MIGRATION.slice(MIGRATION.indexOf("INSERT INTO evidence_validity_policy"));
    const seeded = [...insert.matchAll(/\('([a-z0-9_]+)', 1,/g)].map((m) => m[1]).sort();
    expect(seeded).toEqual(["soc1", "soc2_type1", "soc2_type2"]);
  });

  it("'unclassified' can never carry a policy", () => {
    expect(MIGRATION).toContain("evidence_validity_policy_no_unclassified_check");
  });
});

describe("lockstep with migration 20261085 (D2-D14)", () => {
  it("the anchor vocabulary matches the AMENDED CHECK", () => {
    const m = MIGRATION_D2_D14.match(/anchor IN \(([^)]*)\)/);
    expect(m).not.toBeNull();
    const inSql = [...m![1].matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1]).sort();
    expect(inSql).toEqual([...VALIDITY_ANCHORS].sort());
  });

  it("the anchor rename is guarded — it aborts if any row already used artifact_term", () => {
    expect(MIGRATION_D2_D14).toContain("refusing to rename anchor");
  });

  it("seeds every ratified class and NOT the two ruled to have no row", () => {
    // Anchor on the section TITLE, not its number: renumbering the migration
    // must not silently empty this assertion (indexOf -1 slices from the end).
    const at = MIGRATION_D2_D14.indexOf("D3-D12 — the newly ratified classes");
    expect(at).toBeGreaterThan(0);
    const insert = MIGRATION_D2_D14.slice(at);
    const seeded = [...insert.matchAll(/\('([a-z0-9_]+)', 1,/g)].map((m) => m[1]).sort();
    expect(seeded).toEqual([
      "ai_evaluation", "bcp_dr_test", "iso_certification", "pen_test",
      "policy_document", "privacy_agreement", "subprocessor_list",
      "technical_configuration", "vendor_attestation", "vulnerability_scan",
    ]);
    // D13 and D14: no row, ever. Their currency is a human-committed artifact
    // basis, and a row would be the catch-all TTL both rulings forbid.
    expect(seeded).not.toContain("contract");
    expect(seeded).not.toContain("other_assurance_report");
  });

  it("D2 preserves the 15-month ceiling and makes 13-15 conditional instead", () => {
    expect(MIGRATION_D2_D14).toContain("bridge_required_above_months");
    // The ratified absolute ceiling is NOT discarded.
    expect(MIGRATION_D2_D14).toMatch(/\('soc2_type2', 2, 12, 15, 3, 'report_period_end', FALSE, FALSE, 12,/);
  });

  it("an object_cadence class pins default = max, so the ceiling is never a fallback", () => {
    expect(MIGRATION_D2_D14).toContain("evidence_validity_policy_object_cadence_ceiling_check");
  });

  it("a class that establishes no window MUST say why", () => {
    expect(MIGRATION_D2_D14).toContain("no_window_reason IS NOT NULL");
    expect(MIGRATION_D2_D14).toContain("model_version_identity_required");
  });
});

describe("rule 1 — no ratified policy means no validity", () => {
  it("refuses when the class has no policy row", () => {
    const w = resolveValidityWindow({
      policy: null,
      orgDurationMonths: null,
      anchorDate: "2025-12-31",
      artifactAssertedUntil: null,
    });
    expect(w).toEqual({ basis: "not_established", validUntil: null, reason: "no_ratified_policy" });
  });

  it("a Type I establishes NO window rather than a guessed one", () => {
    const w = resolveValidityWindow({
      policy: SOC2_TYPE1,
      orgDurationMonths: null,
      anchorDate: "2025-12-31",
      artifactAssertedUntil: null,
    });
    expect(w.basis).toBe("not_established");
    // D12/D1: a class ratified to establish nothing says WHY. The generic slug
    // would read as "nobody decided", when somebody decided precisely this.
    expect(w.reason).toBe("type_i_attests_design_only");
  });

  it("refuses without an anchor date instead of defaulting to today", () => {
    for (const bad of [null, "", "31/12/2025", "2025-13-01x"]) {
      const w = resolveValidityWindow({
        policy: SOC2_TYPE2,
        orgDurationMonths: null,
        anchorDate: bad as string | null,
        artifactAssertedUntil: null,
      });
      expect(w.basis).toBe("not_established");
    }
  });
});

describe("rule 2 — tighten freely, loosen only to the ceiling", () => {
  it("uses the platform default when the customer has set nothing", () => {
    const w = resolveValidityWindow({
      policy: SOC2_TYPE2,
      orgDurationMonths: null,
      anchorDate: "2025-12-31",
      artifactAssertedUntil: null,
    });
    expect(w).toMatchObject({
      basis: "policy_default",
      validUntil: "2026-12-31",
      durationMonths: 12,
      source: "platform",
    });
  });

  it("accepts a customer TIGHTENING below the platform floor", () => {
    // minDurationMonths is the platform's floor for its OWN default, never a
    // bound on the customer. A stricter customer needs no permission.
    const w = resolveValidityWindow({
      policy: SOC2_TYPE2,
      orgDurationMonths: 1,
      anchorDate: "2025-12-31",
      artifactAssertedUntil: null,
    });
    expect(w).toMatchObject({ basis: "policy_default", validUntil: "2026-01-31", source: "customer" });
  });

  it("accepts loosening up to and including the ceiling", () => {
    const w = resolveValidityWindow({
      policy: SOC2_TYPE2,
      orgDurationMonths: 15,
      anchorDate: "2025-12-31",
      artifactAssertedUntil: null,
    });
    expect(w).toMatchObject({ basis: "policy_default", validUntil: "2027-03-31" });
  });

  it("REFUSES loosening past the ceiling — it does not silently clamp", () => {
    const w = resolveValidityWindow({
      policy: SOC2_TYPE2,
      orgDurationMonths: 16,
      anchorDate: "2025-12-31",
      artifactAssertedUntil: null,
    });
    expect(w).toEqual({
      basis: "not_established",
      validUntil: null,
      reason: "customer_duration_exceeds_ceiling",
    });
  });

  it("rejects a nonsense customer duration", () => {
    for (const bad of [0, -3, 1.5]) {
      const w = resolveValidityWindow({
        policy: SOC2_TYPE2,
        orgDurationMonths: bad,
        anchorDate: "2025-12-31",
        artifactAssertedUntil: null,
      });
      expect(w.reason).toBe("customer_duration_invalid");
    }
  });
});

describe("rule 3 — the artifact always outranks the policy", () => {
  it("caps a computed window to what the artifact itself asserts", () => {
    const w = resolveValidityWindow({
      policy: SOC2_TYPE2,
      orgDurationMonths: null,
      anchorDate: "2025-12-31",
      artifactAssertedUntil: "2026-06-30",
    });
    expect(w).toMatchObject({
      basis: "policy_default",
      validUntil: "2026-06-30",
      cappedByArtifact: true,
      reason: "capped_by_artifact_asserted_end",
    });
  });

  it("does NOT extend a window to reach a later artifact date", () => {
    const w = resolveValidityWindow({
      policy: SOC2_TYPE2,
      orgDurationMonths: null,
      anchorDate: "2025-12-31",
      artifactAssertedUntil: "2030-01-01",
    });
    expect(w).toMatchObject({ validUntil: "2026-12-31", cappedByArtifact: false });
  });

  it("a customer cannot loosen past an artifact's own end", () => {
    const w = resolveValidityWindow({
      policy: SOC2_TYPE2,
      orgDurationMonths: 15,
      anchorDate: "2025-12-31",
      artifactAssertedUntil: "2026-02-28",
    });
    expect(w).toMatchObject({ validUntil: "2026-02-28", cappedByArtifact: true });
  });
});

describe("month arithmetic never silently gains days", () => {
  it("clamps to the last day of a shorter target month", () => {
    expect(addMonths("2025-01-31", 1)).toBe("2025-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29"); // leap year
    expect(addMonths("2025-08-31", 6)).toBe("2026-02-28");
  });

  it("rolls the year correctly", () => {
    expect(addMonths("2025-12-31", 12)).toBe("2026-12-31");
    expect(addMonths("2025-12-31", 15)).toBe("2027-03-31");
    expect(addMonths("2025-01-01", 24)).toBe("2027-01-01");
  });
});

describe("currency is a read-time question", () => {
  const w = resolveValidityWindow({
    policy: SOC2_TYPE2,
    orgDurationMonths: null,
    anchorDate: "2025-12-31",
    artifactAssertedUntil: null,
  });

  it("is current before the end and not after it", () => {
    expect(isWindowCurrent(w, "2026-09-01")).toBe(true);
    expect(isWindowCurrent(w, "2026-12-31")).toBe(true);
    expect(isWindowCurrent(w, "2027-01-01")).toBe(false);
  });

  it("an unestablished window is NEVER current", () => {
    const none = resolveValidityWindow({
      policy: null,
      orgDurationMonths: null,
      anchorDate: "2025-12-31",
      artifactAssertedUntil: null,
    });
    expect(isWindowCurrent(none, "1900-01-01")).toBe(false);
  });
});

describe("the measured estate, as ratified", () => {
  it("a 12-month rule leaves the staging corpus current; 6 months would not", () => {
    // Every staging extraction shares the period ending 2025-12-31.
    const twelve = resolveValidityWindow({
      policy: SOC2_TYPE2,
      orgDurationMonths: null,
      anchorDate: "2025-12-31",
      artifactAssertedUntil: null,
    });
    expect(isWindowCurrent(twelve, "2026-09-01")).toBe(true);

    const six = resolveValidityWindow({
      policy: SOC2_TYPE2,
      orgDurationMonths: 6,
      anchorDate: "2025-12-31",
      artifactAssertedUntil: null,
    });
    expect(isWindowCurrent(six, "2026-09-01")).toBe(false);
  });
});

/* ===========================================================================
   D2-D14 — adversarial. Every test here is an attempt to make the resolver
   assert something the platform cannot know, or to slip past a ratified
   ceiling. The expected outcome is always a refusal with a NAMED reason.
   =========================================================================== */

describe("D2 — the bridge condition, not a lowered ceiling", () => {
  it("12 months still resolves normally", () => {
    const w = resolveValidityWindow({
      policy: SOC2_TYPE2_D2, orgDurationMonths: null,
      anchorDate: "2025-12-31", artifactAssertedUntil: null,
    });
    expect(w.basis).toBe("policy_default");
    expect(w.validUntil).toBe("2026-12-31");
  });

  it("month 13 is REFUSED while no governed bridge exists", () => {
    const w = resolveValidityWindow({
      policy: SOC2_TYPE2_D2, orgDurationMonths: 13,
      anchorDate: "2025-12-31", artifactAssertedUntil: null,
    });
    expect(w.basis).toBe("not_established");
    expect(w.reason).toBe("governed_bridge_required");
  });

  it("month 15 — the ratified absolute ceiling — is still refused unbridged", () => {
    const w = resolveValidityWindow({
      policy: SOC2_TYPE2_D2, orgDurationMonths: 15,
      anchorDate: "2025-12-31", artifactAssertedUntil: null,
    });
    expect(w.reason).toBe("governed_bridge_required");
  });

  it("16 is refused by the ceiling, not by the bridge — the ceiling still binds", () => {
    const w = resolveValidityWindow({
      policy: SOC2_TYPE2_D2, orgDurationMonths: 16,
      anchorDate: "2025-12-31", artifactAssertedUntil: null,
    });
    expect(w.reason).toBe("customer_duration_exceeds_ceiling");
  });

  it("a bridge that does not reach the window's end does not rescue it", () => {
    const w = resolveValidityWindow({
      policy: SOC2_TYPE2_D2, orgDurationMonths: 15,
      anchorDate: "2025-12-31", artifactAssertedUntil: null,
      bridgeCoverageUntil: "2026-06-30",
    });
    expect(w.reason).toBe("governed_bridge_required");
  });

  it("a bridge covering the full gap makes months 13-15 count, exactly as D2 ratified", () => {
    const w = resolveValidityWindow({
      policy: SOC2_TYPE2_D2, orgDurationMonths: 15,
      anchorDate: "2025-12-31", artifactAssertedUntil: null,
      bridgeCoverageUntil: "2027-03-31",
    });
    expect(w.basis).toBe("policy_default");
    expect(w.validUntil).toBe("2027-03-31");
  });
});

describe("D3 — a required artifact end fails closed", () => {
  it("no recorded certificate expiry means NO window, not the policy default", () => {
    const w = resolveValidityWindow({
      policy: ISO_CERT, orgDurationMonths: null,
      anchorDate: "2025-01-15", artifactAssertedUntil: null,
    });
    expect(w.basis).toBe("not_established");
    expect(w.reason).toBe("artifact_end_required");
  });

  it("a recorded expiry gives the 12-month re-evidence window inside the term", () => {
    const w = resolveValidityWindow({
      policy: ISO_CERT, orgDurationMonths: null,
      anchorDate: "2025-01-15", artifactAssertedUntil: "2028-01-14",
    });
    expect(w.basis).toBe("policy_default");
    expect(w.validUntil).toBe("2026-01-15");
  });

  it("D4 loosening to the full 36 can NEVER outlive the certificate itself", () => {
    const w = resolveValidityWindow({
      policy: ISO_CERT, orgDurationMonths: 36,
      anchorDate: "2025-01-15", artifactAssertedUntil: "2026-06-30",
    });
    expect(w.basis).toBe("policy_default");
    expect(w.validUntil).toBe("2026-06-30");
    if (w.basis === "policy_default") expect(w.cappedByArtifact).toBe(true);
  });

  it("loosening past 36 is refused outright", () => {
    const w = resolveValidityWindow({
      policy: ISO_CERT, orgDurationMonths: 37,
      anchorDate: "2025-01-15", artifactAssertedUntil: "2030-01-01",
    });
    expect(w.reason).toBe("customer_duration_exceeds_ceiling");
  });
});

describe("D7 / D10 — the linked object's cadence, and the ceiling that outranks it", () => {
  it("no linked object means NO window — the 24-month ceiling is never a fallback", () => {
    const w = resolveValidityWindow({
      policy: VENDOR_ATTESTATION, orgDurationMonths: null,
      anchorDate: "2025-01-01", artifactAssertedUntil: null,
    });
    expect(w.basis).toBe("not_established");
    expect(w.reason).toBe("no_linked_object_cadence");
  });

  it("a SHORTER governed cadence wins over the ceiling", () => {
    const w = resolveValidityWindow({
      policy: VENDOR_ATTESTATION, orgDurationMonths: null,
      anchorDate: "2025-01-01", artifactAssertedUntil: null,
      linkedCadenceUntil: "2025-07-01",
    });
    expect(w.basis).toBe("policy_default");
    expect(w.validUntil).toBe("2025-07-01");
    if (w.basis === "policy_default") expect(w.cappedByLinkedCadence).toBe(true);
  });

  it("a 120-month engagement cadence CANNOT keep a 10-year-old attestation current", () => {
    const w = resolveValidityWindow({
      policy: VENDOR_ATTESTATION, orgDurationMonths: null,
      anchorDate: "2025-01-01", artifactAssertedUntil: null,
      linkedCadenceUntil: "2035-01-01",
    });
    expect(w.basis).toBe("policy_default");
    // The absolute 24-month SecureLogic ceiling, not the customer's cadence.
    expect(w.validUntil).toBe("2027-01-01");
    if (w.basis === "policy_default") expect(w.cappedByLinkedCadence).toBe(false);
  });

  it("a customer may still tighten below the ceiling", () => {
    const w = resolveValidityWindow({
      policy: VENDOR_ATTESTATION, orgDurationMonths: 6,
      anchorDate: "2025-01-01", artifactAssertedUntil: null,
      linkedCadenceUntil: "2035-01-01",
    });
    expect(w.validUntil).toBe("2025-07-01");
  });
});

describe("D12 — the platform says what it cannot know", () => {
  it("an unbound AI evaluation establishes nothing, and names model identity as the reason", () => {
    const AI_EVAL: ValidityPolicyRow = {
      assuranceClass: "ai_evaluation",
      defaultDurationMonths: null, maxDurationMonths: null, minDurationMonths: null,
      anchor: "none", requiresArtifactEnd: false, artifactBasisPermitted: false,
      bridgeRequiredAboveMonths: null, noWindowReason: "model_version_identity_required",
    };
    const w = resolveValidityWindow({
      policy: AI_EVAL, orgDurationMonths: null,
      anchorDate: "2026-08-01", artifactAssertedUntil: null,
    });
    expect(w.basis).toBe("not_established");
    expect(w.reason).toBe("model_version_identity_required");
    expect(w.validUntil).toBeNull();
  });
});

describe("global principle 3 — the artifact outranks everything", () => {
  it("an artifact end beats a linked cadence AND the ceiling together", () => {
    const w = resolveValidityWindow({
      policy: VENDOR_ATTESTATION, orgDurationMonths: null,
      anchorDate: "2025-01-01",
      artifactAssertedUntil: "2025-03-01",
      linkedCadenceUntil: "2025-07-01",
    });
    expect(w.validUntil).toBe("2025-03-01");
    if (w.basis === "policy_default") {
      expect(w.cappedByArtifact).toBe(true);
      expect(w.cappedByLinkedCadence).toBe(false);
    }
  });
});
