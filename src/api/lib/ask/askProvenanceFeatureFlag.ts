/**
 * askProvenanceFeatureFlag.ts — the flag for Ask's claim-verification pass.
 *
 * Separate from `SECURELOGIC_ASK_TOOLS_ENABLED` even though provenance is
 * meaningless without the tool path, because the two carry different risks and
 * must be able to fail independently.
 *
 * The tool flag changes WHERE answers come from. This one adds a second model
 * round trip after every answer, which costs latency and tokens on a synchronous
 * user-facing request. If that cost turns out to be unacceptable in staging, the
 * right response is to turn provenance off and keep the tool path — not to roll
 * back retrieval because a display feature was slow.
 *
 * Defaults OFF. Provenance failing OPEN is also deliberate and lives in
 * `provenancePass.ts`: a claims pass that errors degrades to the plain answer
 * rather than failing the turn. A provenance feature that can take Ask down is a
 * worse outcome than one that is occasionally absent.
 */

export function askProvenanceEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["SECURELOGIC_ASK_PROVENANCE_ENABLED"] === "true";
}
