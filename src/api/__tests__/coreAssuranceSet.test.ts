/**
 * coreAssuranceSet.test.ts — the SecureLogic Core Assurance Set v1: sixteen
 * presumptive objectives, each with deterministic factual applicability.
 *
 * What is asserted, and why it matters:
 *   - the set is exactly the sixteen owner-approved objectives, in order;
 *   - every objective's tags are closed-vocabulary and resolve to the domain
 *     the curator declared (a tag edit that moves a question set fails here);
 *   - every canonical control an objective cites exists in the corpus, so the
 *     evidence path can never join to nothing;
 *   - applicability reads FACTS only — the same facts give the same decisions,
 *     and NO decision depends on tier, criticality or inherent band;
 *   - the nominal relationship (no data, no access, no dependency, no AI)
 *     legitimately has NOTHING applicable, and the exposed one has everything;
 *   - each not-applicable decision carries a by-value basis (signals + facts).
 */

import { describe, expect, it } from "vitest";

import {
  CORE_ASSURANCE_OBJECTIVES,
  CORE_ASSURANCE_REFERENCES,
  CORE_ASSURANCE_SET_VERSION,
  CORE_ASSURANCE_TEMPLATE_KEY,
  coreAssuranceObjective,
  coreAssuranceRuleId,
  decideCoreApplicability,
  deriveExposureSignals,
} from "../lib/vendorRisk/coreAssuranceSet.js";
import { CANONICAL_CONTROL_CORPUS } from "../lib/controls/canonicalControlCorpus.js";
import { SCOPE_TAG_VOCABULARY } from "../lib/vendorRisk/requirementScopeTags.js";
import { domainForScopeTags } from "../lib/vendorRisk/requirementDomain.js";
import { FRAMEWORK_TEMPLATES } from "../lib/frameworkTemplates.js";
import { factsFromInherent, resolveFacts, type FactSet } from "../lib/vendorRisk/factResolver.js";
import type { InherentRiskInput } from "../lib/vendorRisk/inherentRisk.js";
import type { FactRow } from "../lib/vendorRisk/factRegistry.js";

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

const EXPOSED: InherentRiskInput = {
  data_sensitivity: "restricted",
  data_volume: "large",
  access_level: "read_write",
  operational_dependency: "critical",
  recoverability: "weeks",
  business_criticality: "critical",
  regulatory_exposure: "high",
  regulatory_breach_notification: true,
  ai_involvement: "embedded",
  ai_autonomy: "human_in_the_loop",
  hosting_model: "multi_tenant_saas",
  fourth_party_exposure: "moderate",
  concentration: "moderate",
};

function facts(inherent: InherentRiskInput, extra: FactRow[] = []): FactSet {
  return resolveFacts([...factsFromInherent(inherent), ...extra]);
}

const extraFact = (key: string, value: unknown): FactRow => ({
  fact_key: key,
  value,
  source: "intake",
  origin: "intake",
  status: "accepted",
});

const decisions = (f: FactSet) => CORE_ASSURANCE_OBJECTIVES.map((o) => decideCoreApplicability(o, f));
const applicableRefs = (f: FactSet) => decisions(f).filter((d) => d.applicable).map((d) => d.reference);

describe("the set", () => {
  it("is exactly the sixteen owner-approved objectives, CAS-01..CAS-16, in order", () => {
    expect(CORE_ASSURANCE_SET_VERSION).toBe("1.0");
    expect(CORE_ASSURANCE_REFERENCES).toEqual(
      Array.from({ length: 16 }, (_, i) => `CAS-${String(i + 1).padStart(2, "0")}`)
    );
    const titles = CORE_ASSURANCE_OBJECTIVES.map((o) => o.title.toLowerCase());
    // WA-3 ruling 3: "programme" -> "program". SecureLogic-authored prose is
    // US English; official external framework names are not touched.
    expect(titles[0]).toContain("information-security program");
    expect(titles[2]).toContain("screening");
    expect(titles[10]).toContain("subcontractors");
    expect(titles[15]).toContain("obligations");
  });

  it("is a real, activatable framework template with the same sixteen requirements", () => {
    const t = FRAMEWORK_TEMPLATES[CORE_ASSURANCE_TEMPLATE_KEY]!;
    expect(t.name).toBe("SecureLogic Core Assurance Set");
    expect(t.requirements.map((r) => r.reference_id)).toEqual([...CORE_ASSURANCE_REFERENCES]);
    for (const r of t.requirements) expect(r.description!.length).toBeGreaterThan(40);
  });

  it("every objective's tags are closed-vocabulary, include `core`, and resolve to the declared domain", () => {
    for (const o of CORE_ASSURANCE_OBJECTIVES) {
      expect(o.tags, o.reference).toContain("core");
      for (const tag of o.tags) expect(SCOPE_TAG_VOCABULARY as readonly string[], o.reference).toContain(tag);
      expect(domainForScopeTags(o.tags), o.reference).toBe(o.domain);
    }
  });

  it("every canonical control an objective cites exists in the published corpus", () => {
    const slugs = new Set(CANONICAL_CONTROL_CORPUS.map((c) => c.slug));
    for (const o of CORE_ASSURANCE_OBJECTIVES) {
      expect(o.canonical_control_slugs.length, o.reference).toBeGreaterThan(0);
      for (const slug of o.canonical_control_slugs) expect(slugs.has(slug), `${o.reference} -> ${slug}`).toBe(true);
    }
  });

  it("rule ids are S1.core.<ref> and satisfy the applicability record's CHECK grammar", () => {
    for (const ref of CORE_ASSURANCE_REFERENCES) {
      const id = coreAssuranceRuleId(ref);
      expect(id).toMatch(/^S[1-5]\.[a-z0-9_.]+$/);
      expect(id).toBe(`S1.core.${ref.toLowerCase().replace("-", "_")}`);
    }
    expect(coreAssuranceObjective("CAS-07")!.reference).toBe("CAS-07");
    expect(coreAssuranceObjective("CC6.1")).toBeNull();
  });
});

describe("applicability is factual, deterministic and tier-blind", () => {
  it("a NOMINAL relationship has NOTHING applicable — no questionnaire is the honest result", () => {
    const f = facts(NOMINAL);
    expect(applicableRefs(f)).toEqual([]);
    const s = deriveExposureSignals(f);
    expect(s.any_exposure).toBe(false);
    // Technology is PRESUMED when the service type is undeclared — but with
    // nothing exposed, presumption alone must not manufacture a question.
    expect(s.technology).toBe(true);
  });

  it("a fully EXPOSED relationship has all sixteen applicable", () => {
    expect(applicableRefs(facts(EXPOSED))).toEqual([...CORE_ASSURANCE_REFERENCES]);
  });

  it("removes exactly the objectives the facts say do not apply, with a specific reason each", () => {
    // Data only: no access, no dependency, no fourth parties, no regulation.
    const dataOnly = facts({ ...NOMINAL, data_sensitivity: "internal" });
    const refs = applicableRefs(dataOnly);
    expect(refs).toContain("CAS-14"); // in transit / at rest
    expect(refs).toContain("CAS-15"); // retention / disposal
    expect(refs).toContain("CAS-05"); // confidentiality
    expect(refs).not.toContain("CAS-10"); // continuity — no dependency
    expect(refs).not.toContain("CAS-11"); // fourth parties — none declared
    expect(refs).not.toContain("CAS-03"); // screening — internal data only, no access
    const cas10 = decisions(dataOnly).find((d) => d.reference === "CAS-10")!;
    expect(cas10.applicable).toBe(false);
    expect(cas10.rationale).toMatch(/do not materially depend/);
    expect(cas10.basis.signals).toEqual({ operational_dependency: false });
    expect(cas10.basis.facts).toEqual({
      "core.operational_dependency": "low",
      "core.business_criticality": "low",
    });
  });

  it("vulnerability and patch management need technology AND exposure — professional services with data only asks neither", () => {
    const pro = facts({ ...NOMINAL, data_sensitivity: "confidential" }, [extraFact("service.type", "professional_services")]);
    const refs = applicableRefs(pro);
    expect(refs).not.toContain("CAS-12");
    expect(refs).not.toContain("CAS-13");
    expect(refs).toContain("CAS-14");
    const saas = facts({ ...NOMINAL, data_sensitivity: "confidential" }, [extraFact("service.type", "saas")]);
    expect(applicableRefs(saas)).toContain("CAS-12");
    expect(applicableRefs(saas)).toContain("CAS-13");
  });

  it("fourth-party management applies on declared sub-processors or third-party models, not only on the inherent exposure level", () => {
    const declared = facts(NOMINAL, [
      extraFact("nth.subprocessors_declared", true),
      extraFact("data.personal_data", true),
    ]);
    expect(applicableRefs(declared)).toContain("CAS-11");
    expect(applicableRefs(declared)).toContain("CAS-16"); // personal data ⇒ obligations
  });

  it("personnel screening applies on sensitive data, on system access, or on a critical service", () => {
    expect(applicableRefs(facts({ ...NOMINAL, access_level: "read_only" }))).toContain("CAS-03");
    expect(applicableRefs(facts({ ...NOMINAL, operational_dependency: "high" }))).toContain("CAS-03");
    expect(applicableRefs(facts({ ...NOMINAL, data_sensitivity: "internal" }))).not.toContain("CAS-03");
    expect(applicableRefs(facts({ ...NOMINAL, data_sensitivity: "confidential" }))).toContain("CAS-03");
  });

  it("the same facts produce the same decisions and the same basis, every time", () => {
    const f = facts({ ...EXPOSED, fourth_party_exposure: "none" });
    const a = JSON.stringify(decisions(f));
    const b = JSON.stringify(decisions(f));
    expect(a).toBe(b);
    expect(decisions(f).find((d) => d.reference === "CAS-11")!.applicable).toBe(false);
  });

  it("no objective reads tier, criticality band or inherent band — only facts", () => {
    // The rule surface is a function of ExposureSignals alone; the signals are
    // a function of the FactSet alone. Assert the shape at runtime as well as
    // by type: every objective's declared signals are real signal names.
    const f = facts(EXPOSED);
    const signalNames = Object.keys(deriveExposureSignals(f));
    for (const o of CORE_ASSURANCE_OBJECTIVES) {
      expect(o.signals.length, o.reference).toBeGreaterThan(0);
      for (const s of o.signals) expect(signalNames, o.reference).toContain(s);
      expect(o.applies.length).toBe(1);
    }
  });
});
