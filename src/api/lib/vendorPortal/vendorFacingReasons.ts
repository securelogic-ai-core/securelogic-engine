/**
 * vendorFacingReasons.ts — WA-3 ruling 1: what a VENDOR is told about why a
 * question is being asked.
 *
 * A scope reason carries three things: SecureLogic's internal scope-rule
 * identifier (`rule_id`), the family that rule belongs to (`rule_family`), and
 * a human-readable `rationale`. The first two are provenance. They exist so
 * composition is deterministic, so an analyst can trace why an item entered
 * scope, and so a historical assessment can be reconstructed — and they must
 * keep existing for exactly those reasons.
 *
 * They are not an explanation. A vendor reading `S1.core.cas_06` learns
 * nothing, and shipping it invites them to treat our rule ids as a contract we
 * never offered.
 *
 * So the vendor gets the rationale, and only the rationale. This is a
 * projection at the portal boundary, not a deletion: `si.reasons` still holds
 * the full triple, and the analyst-facing engagement read still returns it.
 * Dropping the fields from the payload rather than only from the markup also
 * means they cannot be read out of the network response.
 */

/** What the portal ships. The human sentence, nothing else. */
export type VendorFacingReason = { rationale: string };

type StoredReason = { rule_id?: unknown; rule_family?: unknown; rationale?: unknown };

/**
 * `si.reasons` is JSONB and therefore `unknown` at the boundary. Anything that
 * is not a usable sentence is dropped rather than rendered as an empty bullet.
 */
export function vendorFacingReasons(stored: unknown): VendorFacingReason[] | null {
  if (!Array.isArray(stored)) return null;
  const out: VendorFacingReason[] = [];
  for (const item of stored) {
    if (typeof item !== "object" || item === null) continue;
    const rationale = (item as StoredReason).rationale;
    if (typeof rationale !== "string") continue;
    const trimmed = rationale.trim();
    if (trimmed.length === 0) continue;
    out.push({ rationale: trimmed });
  }
  return out;
}
