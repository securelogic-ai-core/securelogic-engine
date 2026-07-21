/**
 * briefingLayoutValidation.ts — pure validation for the persisted Briefing
 * layout envelope (Briefing Initiative B2).
 *
 * The FIRST consumer of the generated engine module manifest
 * (briefingModuleManifest.ts / briefingModuleManifest.generated.ts — the B1
 * hardening precondition): every client-supplied moduleId is validated against
 * the engine's OWN committed manifest, never the client catalog.
 *
 * What this validates: IDENTITY and SHAPE — the ratified instance-shaped
 * versioned envelope (docs/specs/briefing-initiative-b2-spec.md):
 *   { version: 1, modules: [{ moduleId, instanceKey, config }] }
 * B2 invariants: version === 1; instanceKey === moduleId (single-instance
 * phase); config === {} (no speculative fields — the B1.1 evolution policy);
 * no duplicate moduleId; 1..24 entries; every moduleId known to the manifest.
 *
 * What this deliberately does NOT validate (architect ruling C4): session
 * ELIGIBILITY. A known-but-currently-ineligible module id (flag off,
 * entitlement-shy) is ACCEPTED — eligibility is a render-time concern
 * re-resolved against the registry on every render, so a stored layout never
 * grants access, and rejecting here would fail saves whenever a flag flips.
 *
 * Pure and DB-free (the *Validation.ts convention): returns a discriminated
 * union — { input } on success (a NORMALIZED, rebuilt envelope — nothing from
 * the raw payload is passed through by reference) or { error, detail? }.
 */

import {
  BRIEFING_MODULE_MANIFEST,
} from "./briefingModuleManifest.generated.js";
import { isKnownBriefingModuleId } from "./briefingModuleManifest.js";

export const BRIEFING_LAYOUT_VERSION = 1 as const;

/** Defense-in-depth cap — the manifest has 8 modules today; 24 leaves headroom. */
export const BRIEFING_LAYOUT_MAX_MODULES = 24;

export type BriefingLayoutModuleEntry = {
  moduleId: string;
  instanceKey: string;
  config: Record<string, never>;
};

export type BriefingLayoutEnvelope = {
  version: typeof BRIEFING_LAYOUT_VERSION;
  modules: BriefingLayoutModuleEntry[];
};

export type BriefingLayoutValidationResult =
  | { input: BriefingLayoutEnvelope }
  | { error: string; detail?: string };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function validateBriefingLayoutEnvelope(
  raw: unknown,
): BriefingLayoutValidationResult {
  if (!isPlainObject(raw)) {
    return { error: "layout_must_be_object" };
  }
  if (raw.version !== BRIEFING_LAYOUT_VERSION) {
    return {
      error: "layout_version_unsupported",
      detail: `expected version ${BRIEFING_LAYOUT_VERSION}`,
    };
  }
  const rawModules = raw.modules;
  if (!Array.isArray(rawModules)) {
    return { error: "layout_modules_must_be_array" };
  }
  if (rawModules.length < 1) {
    return { error: "layout_requires_at_least_one_module" };
  }
  if (rawModules.length > BRIEFING_LAYOUT_MAX_MODULES) {
    return {
      error: "layout_too_many_modules",
      detail: `max ${BRIEFING_LAYOUT_MAX_MODULES}`,
    };
  }

  const seen = new Set<string>();
  const modules: BriefingLayoutModuleEntry[] = [];
  for (const entry of rawModules) {
    if (!isPlainObject(entry)) {
      return { error: "layout_module_entry_invalid" };
    }
    const { moduleId, instanceKey, config } = entry;
    if (typeof moduleId !== "string" ||
        !isKnownBriefingModuleId(BRIEFING_MODULE_MANIFEST, moduleId)) {
      return { error: "layout_module_id_unknown", detail: String(moduleId) };
    }
    // B2 single-instance rule: one instance per module, keyed by the module id.
    // Multi-instance (distinct instanceKey values) arrives with its first
    // consumer (a configured-module phase), not before.
    if (instanceKey !== moduleId) {
      return { error: "layout_instance_key_invalid", detail: moduleId };
    }
    // B2 empty-config rule (evolution policy: fields land with their first
    // consumer). A non-empty config is a future phase's payload — reject it.
    if (!isPlainObject(config) || Object.keys(config).length !== 0) {
      return { error: "layout_module_config_must_be_empty", detail: moduleId };
    }
    if (seen.has(moduleId)) {
      return { error: "layout_duplicate_module", detail: moduleId };
    }
    seen.add(moduleId);
    modules.push({ moduleId, instanceKey: moduleId, config: {} });
  }

  return { input: { version: BRIEFING_LAYOUT_VERSION, modules } };
}
