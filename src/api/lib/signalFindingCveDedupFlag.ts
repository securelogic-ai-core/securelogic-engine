/**
 * signalFindingCveDedupFlag.ts — gate for CVE-grain finding deduplication in
 * the signal→finding auto-create path.
 *
 * The D-14 guard in cyberSignalProcessingService is per-signal (org, source_id):
 * re-firing the matcher on the SAME signal reuses the finding. It cannot see
 * ACROSS signals — so multiple sources reporting the same CVE (cisa_kev + nvd),
 * or a re-ingested signal under a fresh id, each mint a separate open finding
 * for the same vulnerability and entity. Verified on staging 2026-08-05: six
 * open findings for CVE-2026-20316 / Cisco carrying three different severities.
 * One vulnerability, six work items — triage noise that erodes trust in the
 * queue.
 *
 * When ON, an ACTIVE cyber_signal finding for the same (org, CVE, matched
 * entity) is REUSED instead of a new row being inserted; per-signal provenance
 * (suggestions, links, actions) still attaches to the reused finding exactly as
 * the D-14 re-fire path always has. Signals with no CVE keep per-signal grain.
 *
 * ON only when SECURELOGIC_SIGNAL_FINDING_CVE_DEDUP_ENABLED === "true". With
 * the flag unset (the default, and the state in staging/prod until deliberately
 * flipped), the auto-create path issues no extra query and behaves exactly as
 * before this feature — the INSERT grain change is a behavior change on a live
 * production path, so it activates per-env, never silently.
 */
export function signalFindingCveDedupEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env["SECURELOGIC_SIGNAL_FINDING_CVE_DEDUP_ENABLED"] === "true";
}
