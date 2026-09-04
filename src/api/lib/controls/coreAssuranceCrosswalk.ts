/**
 * coreAssuranceCrosswalk.ts — the THIRD corpus for the governed canonical
 * control crosswalk: the SecureLogic Core Assurance Set v1.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * Assessment Composition v1 says a Core Assurance objective that governed,
 * current, in-scope evidence already covers is asked as a confirmation, not in
 * full. The ONLY way evidence reaches a requirement in this codebase is the S4
 * chain: a report's tested control resolves to a canonical control, the
 * published crosswalk fans that control out to CANDIDATE requirements, a human
 * records a sufficiency determination against one, and the counting predicate
 * counts it. This corpus is what puts the sixteen objectives on the far end of
 * that chain. No new evidence machinery; content for an architecture that
 * exists.
 *
 * ── Mapping discipline ──────────────────────────────────────────────────────
 * Every entry is derived from the objective's own `canonical_control_slugs` in
 * `coreAssuranceSet.ts`, so the objective and its evidence path are one
 * declaration. Conservative by design: an objective maps only to the controls
 * whose tested effectiveness would actually speak to it (CAS-14 to the two
 * encryption controls, CAS-10 to continuity plan + backup/restore). A SUFFICIENT
 * determination on ONE mapped requirement is what counts — the crosswalk
 * establishes candidacy, never assurance (same rule as the SOC 2 corpus).
 *
 * All sixteen are `template_represented`: the template creates every one.
 */

import type { CrosswalkEntry } from "./nistCsfCrosswalk.js";
import {
  CORE_ASSURANCE_FRAMEWORK_KEY,
  CORE_ASSURANCE_FRAMEWORK_VERSION,
  CORE_ASSURANCE_OBJECTIVES,
} from "../vendorRisk/coreAssuranceSet.js";

export const CORE_ASSURANCE_CROSSWALK_FRAMEWORK_KEY = CORE_ASSURANCE_FRAMEWORK_KEY;
export const CORE_ASSURANCE_CROSSWALK_FRAMEWORK_VERSION = CORE_ASSURANCE_FRAMEWORK_VERSION;

export const CORE_ASSURANCE_1_0_CROSSWALK: readonly CrosswalkEntry[] = CORE_ASSURANCE_OBJECTIVES.map(
  (o) => ({
    requirement_reference: o.reference,
    canonical_control_slugs: o.canonical_control_slugs,
    rationale: `${o.reference} (${o.title}) is evidenced by the tested effectiveness of: ${o.canonical_control_slugs.join(", ")}.`,
  })
);
