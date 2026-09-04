/**
 * compositionSnapshot.test.ts — the customer-readable composition record is
 * built by value, explains every outcome, and reproduces.
 */

import { describe, expect, it } from "vitest";

import {
  buildCompositionSnapshot,
  compositionSnapshotHash,
  COMPOSITION_SNAPSHOT_VERSION,
  type ComposableRequirement,
} from "../lib/vendorRisk/compositionSnapshot.js";
import { resolveEngagementScope, type ScopeResolverInput } from "../lib/vendorRisk/scopeResolver.js";
import { CORE_ASSURANCE_FRAMEWORK_KEY, CORE_ASSURANCE_OBJECTIVES } from "../lib/vendorRisk/coreAssuranceSet.js";
import type { InherentRiskInput } from "../lib/vendorRisk/inherentRisk.js";

const NOMINAL: InherentRiskInput = {
  data_sensitivity: "none",
  data_volume: "minimal",
  access_level: "none",
  operational_dependency: "low",
  recoverability: "hours",
  business_criticality: "low",
  regulatory_exposure: "none",
  regulatory_breach_notification: false,
  ai_involvement: "none",
  ai_autonomy: "none",
  hosting_model: "on_prem",
  fourth_party_exposure: "none",
  concentration: "none",
};
const SAAS: InherentRiskInput = {
  ...NOMINAL,
  data_sensitivity: "confidential",
  access_level: "read_write",
  operational_dependency: "moderate",
  business_criticality: "medium",
  hosting_model: "multi_tenant_saas",
};

const CORE: ComposableRequirement[] = CORE_ASSURANCE_OBJECTIVES.map((o) => ({
  requirement_id: `cas:${o.reference}`,
  framework_id: "fw-core",
  reference_id: o.reference,
  title: o.title,
  description: o.description,
  scope_tags: [...o.tags],
  framework_key: CORE_ASSURANCE_FRAMEWORK_KEY,
  framework_name: "SecureLogic Core Assurance Set",
}));
const LEGACY: ComposableRequirement[] = [
  {
    requirement_id: "soc2:CC6.1",
    framework_id: "fw-soc2",
    reference_id: "CC6.1",
    title: "Logical access security",
    description: null,
    scope_tags: ["access-control", "iam"],
    framework_key: "soc2",
    framework_name: "SOC 2 Type II",
  },
  {
    requirement_id: "soc2:CC1.1",
    framework_id: "fw-soc2",
    reference_id: "CC1.1",
    title: "Integrity and ethical values",
    description: null,
    scope_tags: ["core"],
    framework_key: "soc2",
    framework_name: "SOC 2 Type II",
  },
];
const REQS = [...CORE, ...LEGACY];

const input = (over: Partial<ScopeResolverInput> = {}): ScopeResolverInput => ({
  tier: "tier_3_moderate",
  inherent: SAAS,
  requirements: REQS,
  obligationEdges: [],
  ...over,
});

const coverage = { computed: true, applied: false, version: "assurance-coverage-1.1", as_of: "2026-09-04", covered_count: 0, gap_count: 0 };

describe("buildCompositionSnapshot", () => {
  it("records every Core Assurance objective with an outcome, a rationale and a by-value basis", () => {
    const resolution = resolveEngagementScope(input());
    const { snapshot } = buildCompositionSnapshot({ resolution, requirements: REQS, coverage, resolvedAt: "2026-09-04T10:00:00.000Z" });

    expect(snapshot.snapshot_version).toBe(COMPOSITION_SNAPSHOT_VERSION);
    expect(snapshot.scope_rule_version).toBe("1.2.0");
    expect(snapshot.core_assurance_version).toBe("1.0");
    expect(snapshot.core_assurance!.objectives).toHaveLength(16);

    const cas11 = snapshot.core_assurance!.objectives.find((o) => o.reference === "CAS-11")!;
    expect(cas11.outcome).toBe("not_applicable");
    expect(cas11.depth).toBeNull();
    expect(cas11.rationale).toMatch(/No material subcontractors/);
    expect(cas11.basis).toMatchObject({ signals: { fourth_parties: false } });

    const cas06 = snapshot.core_assurance!.objectives.find((o) => o.reference === "CAS-06")!;
    expect(cas06.outcome).toBe("asked");
    expect(cas06.depth).toBe("full");
    expect(cas06.title).toMatch(/least privilege/);
    expect(cas06.reasons.map((r) => r.rule_id)).toContain("S1.core.cas_06");
    expect(cas06.domain).toBe("security");

    // the legacy SOC 2 items: CC6.1 enters via access-control (tier tag + S2), CC1.1 (core) does not
    expect(snapshot.additional.map((a) => a.reference)).toEqual(["CC6.1"]);
    expect(snapshot.additional[0]!.framework).toBe("SOC 2 Type II");
    expect(snapshot.summary.excluded_by_rules).toBeGreaterThan(0);
    expect(snapshot.summary.no_questionnaire_required).toBe(false);
    expect(snapshot.summary.core_applicable + snapshot.summary.core_not_applicable).toBe(16);
    expect(snapshot.domains.find((d) => d.domain === "security")!.asked).toBeGreaterThan(0);
  });

  it("marks evidence-satisfied objectives and carries the evidence basis", () => {
    const basis = { determination_id: "det-1", document_id: "doc-1", valid_until: "2027-01-31" };
    const resolution = resolveEngagementScope(
      input({ assuranceCoveredRequirementIds: ["cas:CAS-14"], assuranceCoverageBasis: { "cas:CAS-14": basis } })
    );
    const { snapshot } = buildCompositionSnapshot({
      resolution,
      requirements: REQS,
      coverage: { ...coverage, applied: true, covered_count: 1 },
      resolvedAt: "2026-09-04T10:00:00.000Z",
    });
    const cas14 = snapshot.core_assurance!.objectives.find((o) => o.reference === "CAS-14")!;
    expect(cas14.outcome).toBe("evidence_satisfied");
    expect(cas14.depth).toBe("confirm");
    expect(cas14.evidence).toEqual(basis);
    expect(snapshot.summary.evidence_satisfied).toBe(1);
    expect(snapshot.summary.asked_confirm).toBe(0); // confirm-depth satisfied items are not "asked"
  });

  it("a nominal relationship snapshots as no_questionnaire_required with every objective explained", () => {
    const resolution = resolveEngagementScope(input({ inherent: NOMINAL, tier: "tier_4_low" }));
    const { snapshot } = buildCompositionSnapshot({ resolution, requirements: REQS, coverage, resolvedAt: "2026-09-04T10:00:00.000Z" });
    expect(snapshot.summary.no_questionnaire_required).toBe(true);
    expect(snapshot.summary.asked).toBe(0);
    expect(snapshot.core_assurance!.objectives.every((o) => o.outcome === "not_applicable")).toBe(true);
    expect(snapshot.additional).toEqual([]);
  });

  it("hashes deterministically, independent of the timestamp and of input order", () => {
    const a = buildCompositionSnapshot({ resolution: resolveEngagementScope(input()), requirements: REQS, coverage, resolvedAt: "2026-09-04T10:00:00.000Z" });
    const b = buildCompositionSnapshot({
      resolution: resolveEngagementScope(input({ requirements: [...REQS].reverse() })),
      requirements: [...REQS].reverse(),
      coverage,
      resolvedAt: "2026-09-05T11:11:11.000Z",
    });
    expect(a.hash).toBe(b.hash);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(compositionSnapshotHash(a.snapshot)).toBe(a.hash);
    // and a different composition hashes differently
    const c = buildCompositionSnapshot({ resolution: resolveEngagementScope(input({ tier: "tier_4_low" })), requirements: REQS, coverage, resolvedAt: "2026-09-04T10:00:00.000Z" });
    expect(c.hash).not.toBe(a.hash);
  });

  it("a 1.1.0 resolution snapshots without a core_assurance block", () => {
    const resolution = resolveEngagementScope(input({ scopeRuleVersion: "1.1.0" }));
    const { snapshot } = buildCompositionSnapshot({ resolution, requirements: REQS, coverage, resolvedAt: "2026-09-04T10:00:00.000Z" });
    expect(snapshot.core_assurance).toBeNull();
    expect(snapshot.core_assurance_version).toBeNull();
    expect(snapshot.additional.length).toBe(resolution.items.length);
  });
});
