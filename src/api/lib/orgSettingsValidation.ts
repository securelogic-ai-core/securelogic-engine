/**
 * orgSettingsValidation.ts — pure validation for PATCH /api/org/settings.
 *
 * The organization profile is a partial-update surface: any subset of the
 * fields below may arrive; unknown keys are rejected (a typo'd field name
 * silently doing nothing is how settings pages lie to admins).
 *
 * `regulated` / `handles_pii` / `safety_critical` / `scale` are not cosmetic:
 * they drive context-weighted risk scoring (cyberSignalProcessingService),
 * finding enterprise context, and posture computation. Until this surface
 * existed they were writable only by the operator admin API, so every
 * customer org sat at defaults and the weighting engine never fired —
 * findingEnterpriseContext's `atDefaults` check documents exactly that.
 */

export const ORG_SCALES = ["Small", "Medium", "Enterprise"] as const;
export type OrgScale = (typeof ORG_SCALES)[number];

export const MAX_ORG_NAME_LENGTH = 200;

export interface OrgSettingsPatch {
  name?: string;
  require_mfa?: boolean;
  regulated?: boolean;
  handles_pii?: boolean;
  safety_critical?: boolean;
  scale?: OrgScale;
  /** ASK-C C-1 (LC-4): tenant-level voice governance — admin can disable
   *  Ask voice input for the whole org; enforced engine-side on transcribe. */
  voice_input_enabled?: boolean;
}

export type OrgSettingsPatchResult =
  | { ok: true; patch: OrgSettingsPatch }
  | { ok: false; error: string; detail?: string };

const BOOLEAN_FIELDS = [
  "require_mfa",
  "regulated",
  "handles_pii",
  "safety_critical",
  "voice_input_enabled",
] as const;
const KNOWN_FIELDS = new Set<string>(["name", "scale", ...BOOLEAN_FIELDS]);

export function validateOrgSettingsPatch(body: unknown): OrgSettingsPatchResult {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "invalid_body", detail: "Expected a JSON object." };
  }
  const input = body as Record<string, unknown>;

  const unknown = Object.keys(input).filter((k) => !KNOWN_FIELDS.has(k));
  if (unknown.length > 0) {
    return {
      ok: false,
      error: "unknown_field",
      detail: `Unknown field(s): ${unknown.join(", ")}. Allowed: ${[...KNOWN_FIELDS].join(", ")}.`,
    };
  }

  const patch: OrgSettingsPatch = {};

  if ("name" in input) {
    if (typeof input.name !== "string" || input.name.trim().length === 0) {
      return { ok: false, error: "invalid_name", detail: "Organization name must be a non-empty string." };
    }
    const trimmed = input.name.trim();
    if (trimmed.length > MAX_ORG_NAME_LENGTH) {
      return {
        ok: false,
        error: "invalid_name",
        detail: `Organization name must be at most ${MAX_ORG_NAME_LENGTH} characters.`,
      };
    }
    patch.name = trimmed;
  }

  for (const field of BOOLEAN_FIELDS) {
    if (field in input) {
      if (typeof input[field] !== "boolean") {
        return { ok: false, error: `invalid_${field}`, detail: "Expected a boolean." };
      }
      patch[field] = input[field] as boolean;
    }
  }

  if ("scale" in input) {
    if (
      typeof input.scale !== "string" ||
      !(ORG_SCALES as readonly string[]).includes(input.scale)
    ) {
      return {
        ok: false,
        error: "invalid_scale",
        detail: `Scale must be one of: ${ORG_SCALES.join(", ")}.`,
      };
    }
    patch.scale = input.scale as OrgScale;
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, error: "empty_patch", detail: "Provide at least one field to update." };
  }

  return { ok: true, patch };
}
