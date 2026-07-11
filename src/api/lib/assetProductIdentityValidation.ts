/**
 * assetProductIdentityValidation.ts — PURE validation for the attestation write path.
 *
 * C4 part 2 / ADR-0003 D1-B. No I/O.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE
 *   A human may only ever write `provenance='attestation'`.
 *
 *   `sbom` and `connector` are claims about what a MACHINE OBSERVED. If a person could
 *   post one, they could mint 95/85-confidence "evidence" out of an opinion — and that
 *   confidence is the R2 gate that decides whether a finding may be called `affected`.
 *   The provenance vocabulary is an evidence taxonomy, not a free-text label, so the
 *   route does not accept it as input at all: it is a constant.
 *
 *   `inferred` is likewise not writable. It is what the resolver calls a name
 *   coincidence at read time; persisting one would launder a guess into a record.
 *
 * ADR-0003 D1 ruling: attestation is SUPPORTING EVIDENCE that may override or
 * strengthen applicability. It does not become the primary source of truth and does not
 * redefine canonical relationships — hence no writes here to `assets`,
 * `enterprise_entities`, or any canonical context table. This records only what a human
 * asserts an asset RUNS.
 */

/** The only provenance a human write path may produce. */
export const HUMAN_PROVENANCE = "attestation" as const;

/** Every provenance the 20260905 CHECK admits. Machine values are read-only to the API. */
export const ALL_PROVENANCES = ["attestation", "sbom", "connector", "inferred"] as const;

export interface AttestationInput {
  asset_id: string;
  canonical_product_id: string;
  /** Optional free-text: the ticket, the runbook, the person's reason. */
  evidence_ref: string | null;
}

export type ValidationResult =
  | { input: AttestationInput }
  | { error: string; detail?: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MAX_EVIDENCE_REF = 500;

export function validateAttestationCreate(body: unknown): ValidationResult {
  if (body === null || typeof body !== "object") {
    return { error: "invalid_body" };
  }
  const b = body as Record<string, unknown>;

  // Provenance is NOT accepted from the client — see the header. Reject loudly rather
  // than silently ignoring it, so a caller trying to forge machine evidence learns why.
  if ("provenance" in b) {
    return {
      error: "provenance_not_settable",
      detail:
        "provenance is derived, not supplied: a human write is always 'attestation'. " +
        "'sbom' and 'connector' assert a machine observation and cannot be posted.",
    };
  }
  // Confidence is a property of the EVIDENCE CLASS, not of the asserter's mood. It is
  // fixed per provenance (tenantAssetResolver.IDENTITY_CONFIDENCE) so that the R2 gate
  // cannot be talked around.
  if ("confidence" in b) {
    return {
      error: "confidence_not_settable",
      detail: "confidence is fixed by provenance and is not client-supplied.",
    };
  }

  const asset_id = typeof b["asset_id"] === "string" ? b["asset_id"].trim() : "";
  if (!UUID_RE.test(asset_id)) {
    return { error: "invalid_asset_id", detail: "asset_id must be a uuid" };
  }

  const canonical_product_id =
    typeof b["canonical_product_id"] === "string" ? b["canonical_product_id"].trim() : "";
  if (!UUID_RE.test(canonical_product_id)) {
    return { error: "invalid_canonical_product_id", detail: "canonical_product_id must be a uuid" };
  }

  let evidence_ref: string | null = null;
  const rawRef = b["evidence_ref"];
  if (rawRef !== undefined && rawRef !== null) {
    if (typeof rawRef !== "string") {
      return { error: "invalid_evidence_ref", detail: "evidence_ref must be a string" };
    }
    const t = rawRef.trim();
    if (t.length > MAX_EVIDENCE_REF) {
      return {
        error: "invalid_evidence_ref",
        detail: `evidence_ref must be at most ${MAX_EVIDENCE_REF} characters`,
      };
    }
    evidence_ref = t.length > 0 ? t : null;
  }

  return { input: { asset_id, canonical_product_id, evidence_ref } };
}
