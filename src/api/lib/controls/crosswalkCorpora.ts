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

import type { CrosswalkEntry } from "./nistCsfCrosswalk.js";
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
