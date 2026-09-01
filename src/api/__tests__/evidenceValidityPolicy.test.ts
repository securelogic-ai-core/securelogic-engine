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

const SOC2_TYPE2: ValidityPolicyRow = {
  assuranceClass: "soc2_type2",
  defaultDurationMonths: 12,
  maxDurationMonths: 15,
  minDurationMonths: 3,
  anchor: "report_period_end",
};

/** D1 ratified "its own rule" and named no number. */
const SOC2_TYPE1: ValidityPolicyRow = {
  assuranceClass: "soc2_type1",
  defaultDurationMonths: null,
  maxDurationMonths: null,
  minDurationMonths: null,
  anchor: "none",
};

describe("lockstep with migration 20261083", () => {
  it("the anchor vocabulary matches the CHECK", () => {
    const m = MIGRATION.match(/anchor IN \(([^)]*)\)/);
    expect(m).not.toBeNull();
    const inSql = [...m![1].matchAll(/'([a-z0-9_]+)'/g)].map((x) => x[1]).sort();
    expect(inSql).toEqual([...VALIDITY_ANCHORS].sort());
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
    expect(w.reason).toBe("policy_establishes_no_window");
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
