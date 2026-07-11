/**
 * findingEvidencePayload.ts — pure construction of the POST /api/evidence body
 * for finding-attached evidence.
 *
 * WHY THIS IS ITS OWN MODULE: the engine resolves `source_type` to a table and
 * verifies the source row belongs to the caller's org (routes/evidence.ts:186-202).
 * Send anything other than the exact string "finding" and the request 404s with
 * `source_record_not_found` — the evidence is never written, and for an org
 * enforcing `require_evidence_gate` the finding silently stays stuck at
 * `in_progress` forever. That is precisely the deadlock this feature exists to
 * break, so the contract is worth pinning in a test rather than leaving it inline
 * in a fetch call where a typo is invisible.
 *
 * Pure and dependency-free, so it is unit-testable without a DOM — the same
 * pattern as businessImpact.ts.
 */

/** The canonical evidence_type set (db/migrations/20260420 evidence_type_check). */
export const EVIDENCE_TYPES = [
  "document",
  "screenshot",
  "log",
  "test_result",
  "interview",
  "observation",
  "policy",
  "other",
] as const;

export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export interface FindingEvidenceInput {
  title: string;
  evidence_type: string;
  external_ref?: string | null;
  description?: string | null;
}

export interface FindingEvidencePayload {
  source_type: "finding";
  source_id: string;
  title: string;
  evidence_type: string;
  external_ref: string | null;
  description: string | null;
}

/**
 * Build the request body. Trims the free-text fields and collapses blank strings
 * to null (the column is nullable; an empty string is not "absent" to Postgres).
 * Throws on a blank title — `evidence_title_nonempty` is a CHECK constraint, so a
 * blank one is a 400 from the server; failing here gives the user a real message.
 */
export function buildFindingEvidencePayload(
  findingId: string,
  input: FindingEvidenceInput
): FindingEvidencePayload {
  const title = input.title.trim();
  if (!title) throw new Error("A title is required.");

  const externalRef = input.external_ref?.trim() ?? "";
  const description = input.description?.trim() ?? "";

  return {
    source_type: "finding",
    source_id: findingId,
    title,
    evidence_type: input.evidence_type,
    external_ref: externalRef === "" ? null : externalRef,
    description: description === "" ? null : description,
  };
}

/** Is this a value the evidence_type CHECK constraint will accept? */
export function isValidEvidenceType(value: string): value is EvidenceType {
  return (EVIDENCE_TYPES as readonly string[]).includes(value);
}
