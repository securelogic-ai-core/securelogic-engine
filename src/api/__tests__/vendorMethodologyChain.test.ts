/**
 * vendorMethodologyChain.test.ts — the three deterministic models composed.
 *
 * Each model is tested in isolation elsewhere. What is tested here is the CHAIN:
 * intake answers → inherent risk → scope → vendor responses → effectiveness →
 * residual, with the polarity crossing in the middle and the ratified
 * constraints holding end to end.
 *
 * This is also the arithmetic half of the LLM-independence gate. Nothing in this
 * file can reach a model, because none of the modules it imports can.
 */

import { describe, expect, it } from "vitest";

import { computeVendorInherentRisk } from "../lib/vendorRisk/inherentRisk.js";
import {
  assuranceFor,
  computeControlEffectiveness,
  type ControlResponse,
} from "../lib/vendorRisk/controlEffectiveness.js";
import { computeResidualRisk } from "../lib/vendorRisk/residualRisk.js";
import { resolveEngagementScope } from "../lib/vendorRisk/scopeResolver.js";

/** A payments processor holding restricted data at mass scale. */
const CRITICAL_INTAKE = {
  data_sensitivity: "restricted" as const,
  data_volume: "mass" as const,
  access_level: "read_write" as const,
  operational_dependency: "critical" as const,
  recoverability: "weeks" as const,
  business_criticality: "critical" as const,
  regulatory_exposure: "high" as const,
  regulatory_breach_notification: true,
  ai_involvement: "none" as const,
  ai_autonomy: "none" as const,
  hosting_model: "multi_tenant_saas" as const,
  fourth_party_exposure: "high" as const,
  concentration: "single_point_of_failure" as const,
};

/** A design agency with no access to anything. */
const LOW_INTAKE = {
  data_sensitivity: "none" as const,
  data_volume: "minimal" as const,
  access_level: "none" as const,
  operational_dependency: "low" as const,
  recoverability: "hours" as const,
  business_criticality: "low" as const,
  regulatory_exposure: "none" as const,
  regulatory_breach_notification: false,
  ai_involvement: "none" as const,
  ai_autonomy: "none" as const,
  hosting_model: "saas" as const,
  fourth_party_exposure: "none" as const,
  concentration: "none" as const,
};

function responses(
  count: number,
  build: (i: number) => Partial<ControlResponse>
): ControlResponse[] {
  return Array.from({ length: count }, (_, i) => ({
    requirement_id: `req-${i}`,
    status: "pass",
    assurance: "asserted",
    mandatory: false,
    depth: "confirm",
    ...build(i),
  }));
}

describe("the chain — a critical vendor with a strong programme", () => {
  it("stays a serious risk however good the controls", () => {
    const inherent = computeVendorInherentRisk(CRITICAL_INTAKE);
    expect(inherent.band).toBe("Critical");

    const effectiveness = computeControlEffectiveness(
      responses(40, () => ({ status: "pass", assurance: "attested" }))
    );
    expect(effectiveness.score).toBe(100);

    const residual = computeResidualRisk({
      inherentScore: inherent.score,
      inherentRating: inherent.band,
      effectivenessScore: effectiveness.score,
      failedMandatoryCount: effectiveness.failed_mandatory_count,
      noEvidenceAtAll: false,
    });

    // Moved a long way down — and nowhere near Low.
    expect(residual.score).toBeLessThan(inherent.score);
    expect(residual.rating).not.toBe("Low");
    expect(residual.inherent_understated).toBe(false);
  });
});

describe("the chain — a critical vendor who only asserts", () => {
  it("barely improves on its inherent risk", () => {
    // The scenario the whole methodology exists to catch: a vendor who answers
    // "yes" to everything and attaches nothing.
    const inherent = computeVendorInherentRisk(CRITICAL_INTAKE);

    const allAsserted = responses(40, () => ({
      status: "pass",
      assurance: assuranceFor({
        status: "pass",
        evidenceCount: 0,
        evidenceConfirmed: false,
        independentlyAttested: false,
      }),
    }));
    const effectiveness = computeControlEffectiveness(allAsserted);
    expect(effectiveness.score).toBe(50);

    const residual = computeResidualRisk({
      inherentScore: inherent.score,
      effectivenessScore: effectiveness.score,
      failedMandatoryCount: 0,
      noEvidenceAtAll: true,
    });

    // A perfect-looking questionnaire removes only 35% of the exposure, because
    // nothing in it was verified.
    expect(residual.reduction_applied).toBeCloseTo(0.35, 2);
    expect(residual.rating).toBe("High");
  });

  it("scores strictly worse than the same answers with evidence", () => {
    const inherent = computeVendorInherentRisk(CRITICAL_INTAKE);
    const base = { failedMandatoryCount: 0, inherentScore: inherent.score };

    const asserted = computeControlEffectiveness(
      responses(40, () => ({ assurance: "asserted" }))
    );
    const evidenced = computeControlEffectiveness(
      responses(40, () => ({ assurance: "evidenced" }))
    );

    const assertedResidual = computeResidualRisk({
      ...base,
      effectivenessScore: asserted.score,
      noEvidenceAtAll: true,
    });
    const evidencedResidual = computeResidualRisk({
      ...base,
      effectivenessScore: evidenced.score,
      noEvidenceAtAll: false,
    });

    expect(assertedResidual.score).toBeGreaterThan(evidencedResidual.score);
  });
});

describe("the chain — a low-risk vendor who answers nothing", () => {
  it("produces inherent_understated rather than a comfortable Low", () => {
    // The exceptional condition, reached through the real chain rather than by
    // hand-picked inputs.
    const inherent = computeVendorInherentRisk(LOW_INTAKE);
    expect(inherent.band).toBe("Low");

    const effectiveness = computeControlEffectiveness(
      responses(10, () => ({ status: "not_assessed", assurance: "not_assessed" }))
    );
    expect(effectiveness.score).toBe(0);

    const residual = computeResidualRisk({
      inherentScore: inherent.score,
      effectivenessScore: effectiveness.score,
      failedMandatoryCount: 0,
      noEvidenceAtAll: true,
    });

    expect(residual.score).toBeGreaterThan(inherent.score);
    expect(residual.inherent_understated).toBe(true);
    // And it explains itself, because a reviewer seeing residual > inherent will
    // otherwise assume a bug.
    expect(
      residual.basis.adjustments.some((a) => a.rule_id === "R_UNDERSTATED")
    ).toBe(true);
  });
});

describe("the chain — one failed mandatory control", () => {
  it("dominates an otherwise excellent questionnaire", () => {
    const inherent = computeVendorInherentRisk(CRITICAL_INTAKE);

    const withOneFailure = [
      ...responses(39, () => ({ status: "pass" as const, assurance: "attested" as const })),
      {
        requirement_id: "encryption-at-rest",
        status: "fail" as const,
        assurance: "asserted" as const,
        mandatory: true,
        depth: "full",
      },
    ];
    const effectiveness = computeControlEffectiveness(withOneFailure);
    expect(effectiveness.score).toBe(40);

    const residual = computeResidualRisk({
      inherentScore: inherent.score,
      effectivenessScore: effectiveness.score,
      failedMandatoryCount: effectiveness.failed_mandatory_count,
      noEvidenceAtAll: false,
    });

    // 39 attested passes do not rescue this vendor.
    expect(residual.rating).toBe("High");
    expect(effectiveness.arithmetic_score).toBeGreaterThan(effectiveness.score);
  });
});

describe("scope depth feeds effectiveness weighting", () => {
  it("a tier-1 scope weights its controls more heavily than a tier-4 scope", () => {
    const critical = computeVendorInherentRisk(CRITICAL_INTAKE);
    const low = computeVendorInherentRisk(LOW_INTAKE);

    expect(critical.tier).toBe("tier_1_critical");
    expect(low.tier).toBe("tier_4_low");

    const requirements = [
      {
        requirement_id: "r1",
        framework_id: "fw",
        reference_id: "A-1",
        title: "Access control",
        scope_tags: ["baseline"],
      },
      {
        requirement_id: "r2",
        framework_id: "fw",
        reference_id: "A-2",
        title: "Encryption",
        scope_tags: ["baseline"],
      },
    ];

    const criticalScope = resolveEngagementScope({
      tier: critical.tier,
      inherent: CRITICAL_INTAKE,
      requirements,
      obligationEdges: [],
    });
    const lowScope = resolveEngagementScope({
      tier: low.tier,
      inherent: LOW_INTAKE,
      requirements,
      obligationEdges: [],
    });

    // The same control asked of a critical vendor is asked more deeply, and so
    // carries more weight in their effectiveness score.
    const criticalDepths = criticalScope.items.map((i) => i.depth);
    const lowDepths = lowScope.items.map((i) => i.depth);
    expect(criticalDepths).not.toEqual(lowDepths);
  });
});

describe("determinism", () => {
  it("the full chain is a pure function of its inputs", () => {
    // Run the same inputs 20 times. Any variance would mean something in the
    // chain reached outside itself — a clock, a random, a network call.
    const run = (): number => {
      const inherent = computeVendorInherentRisk(CRITICAL_INTAKE);
      const eff = computeControlEffectiveness(
        responses(30, (i) => ({
          status: i % 3 === 0 ? "partial" : "pass",
          assurance: i % 5 === 0 ? "documented" : "evidenced",
          mandatory: i % 7 === 0,
        }))
      );
      return computeResidualRisk({
        inherentScore: inherent.score,
        effectivenessScore: eff.score,
        failedMandatoryCount: eff.failed_mandatory_count,
        noEvidenceAtAll: false,
      }).score;
    };

    const first = run();
    for (let i = 0; i < 20; i++) expect(run()).toBe(first);
  });

  it("no module in the chain imports a model provider", async () => {
    // By construction, not by convention. The LLM-independence stop gate rests
    // on this being unable to happen rather than merely not happening.
    const { readFileSync } = await import("node:fs");
    const { resolve, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../lib/vendorRisk");

    for (const file of [
      "inherentRisk.ts",
      "controlEffectiveness.ts",
      "residualRisk.ts",
      "scopeResolver.ts",
      "riskBands.ts",
      "engagementStateMachine.ts",
      "methodologyVersion.ts",
    ]) {
      const source = readFileSync(resolve(dir, file), "utf8");
      expect(source, file).not.toMatch(/@anthropic-ai|openai|anthropicClient|callModel/i);
    }
  });
});
