/**
 * evidenceLifecycleFlag.ts — the kill switch for the ADR-0012 evidence
 * lifecycle counting predicate (T2-A / wiring-plan Step 2).
 *
 * Default-DENY (=== "true") everywhere, non-production included, and it is
 * currently read by NOTHING: Step 2 ships dark schema plus a reviewed predicate,
 * with no consumer wired. The flag exists now so that the eventual wiring is a
 * flag flip against tested code rather than a new switch invented at wiring
 * time.
 *
 * ── THIS FLAG IS NOT READY TO BE FLIPPED, AND WILL NOT BE FOR A WHILE ───────
 *
 * Turning it on swaps `EXISTS(evidence row)` for "a live, human-confirmed link
 * to an artifact whose validity is established and current". Against today's
 * estate that predicate returns NOTHING, because:
 *
 *   - no origin links were backfilled (owner direction: fabricate no historical
 *     confirmations), so no evidence row has a link at all; and
 *   - every pre-existing row carries validity_basis='not_established', which
 *     fails closed by design.
 *
 * So the flag is not merely "off until the feature is finished" — it is off
 * until (a) a governed writer exists, (b) a curation path lets humans establish
 * validity and confirm the uses they already rely on, and (c) a dual-read proves
 * ZERO divergence on a real estate. ADR-0012 §5 requires that proof; ADR-0012 §8
 * requires flag-off to be byte-identical to today, which is trivially true while
 * nothing reads this.
 *
 * Deliberately NOT declared in render.yaml: an undeclared key and "false" are
 * identical to the resolver below, so the capability is dark by construction in
 * every environment. Declare it (value "false") in IaC when the writer package
 * lands, not before — a declared flag invites somebody to try it.
 */

export function evidenceLifecycleV2Enabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["SECURELOGIC_EVIDENCE_LIFECYCLE_V2"] === "true";
}
