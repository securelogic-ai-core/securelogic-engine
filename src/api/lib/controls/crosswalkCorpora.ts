/**
 * crosswalkCorpora.ts — the registry of curated crosswalk corpora the
 * publisher publishes.
 *
 * The publisher was written against a single hard-coded corpus (NIST CSF 1.1)
 * because there was only one. VA-S4-4C-1 adds SOC 2 / 2017, and a second
 * hard-coded pair would have meant duplicating the publish, drift-detection and
 * fail-closed logic per framework — three copies to keep honest instead of one.
 *
 * Adding a framework is now: curate a module, add it here, add its identity to
 * CANONICAL_FRAMEWORK_VERSIONS. The publisher's guarantees — a named human
 * approver, no partial publication, drift reported and never silently
 * overwritten — apply to every corpus in this list identically.
 */

import { FRAMEWORK_TEMPLATES } from "../frameworkTemplates.js";
import { resolveCanonicalFrameworkIdentity } from "./canonicalFrameworkIdentity.js";
import type { CrosswalkEntry, CrosswalkScope } from "./nistCsfCrosswalk.js";
import {
  NIST_CSF_1_1_CROSSWALK,
  NIST_CSF_FRAMEWORK_KEY,
  NIST_CSF_FRAMEWORK_VERSION,
} from "./nistCsfCrosswalk.js";
import {
  SOC2_TSC_2017_CROSSWALK,
  SOC2_FRAMEWORK_KEY,
  SOC2_FRAMEWORK_VERSION,
} from "./soc2TscCrosswalk.js";

export type CrosswalkCorpus = {
  /** Must exist in CANONICAL_FRAMEWORK_VERSIONS; the publisher enforces it. */
  readonly framework_key: string;
  readonly framework_version: string;
  readonly entries: readonly CrosswalkEntry[];
};

export const CROSSWALK_CORPORA: readonly CrosswalkCorpus[] = [
  {
    framework_key: NIST_CSF_FRAMEWORK_KEY,
    framework_version: NIST_CSF_FRAMEWORK_VERSION,
    entries: NIST_CSF_1_1_CROSSWALK,
  },
  {
    framework_key: SOC2_FRAMEWORK_KEY,
    framework_version: SOC2_FRAMEWORK_VERSION,
    entries: SOC2_TSC_2017_CROSSWALK,
  },
] as const;

/** A corpus entry's scope, with the documented default applied. */
export function scopeOf(entry: CrosswalkEntry): CrosswalkScope {
  return entry.scope ?? "template_represented";
}

/**
 * The reference ids the SHIPPED template creates for a canonical framework
 * identity, or `null` when no template maps to that identity at all.
 *
 * Resolved through `resolveCanonicalFrameworkIdentity` — the same governed
 * (display name, version) -> identity resolver the activation path uses — so no
 * second template-key-to-framework-key mapping is invented here. `null` and an
 * empty set mean different things and are kept distinct: no template is "this
 * framework is not shipped", an empty set would be "shipped but asks nothing".
 */
export function templateReferencesFor(
  frameworkKey: string,
  frameworkVersion: string
): ReadonlySet<string> | null {
  let found: Set<string> | null = null;
  for (const template of Object.values(FRAMEWORK_TEMPLATES)) {
    const identity = resolveCanonicalFrameworkIdentity(template.name, template.version);
    if (
      identity === null ||
      identity.framework_key !== frameworkKey ||
      identity.framework_version !== frameworkVersion
    ) {
      continue;
    }
    found ??= new Set<string>();
    for (const r of template.requirements) found.add(r.reference_id);
  }
  return found;
}
