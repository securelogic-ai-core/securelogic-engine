/**
 * cyberSignalProcessingService.ts — Signal-to-finding linker, risk exposure
 * flagging, and posture impact hook for cyber signal ingestion.
 *
 * PROCESSING PIPELINE (called after a signal row is committed)
 * ------------------------------------------------------------
 *  1. Vendor matching  — case-insensitive name lookup in vendors table.
 *  2. AI system matching — case-insensitive name lookup in ai_systems table.
 *  3. Finding creation — if any match is found, a finding is created with:
 *       source_type = 'cyber_signal'
 *       source_id   = cyber_signals.id  (NOT the vendor/ai_system id)
 *       domain      = 'Vendor Risk'   (vendor match)
 *                   | 'AI Governance' (AI system match)
 *       severity    = signal.severity
 *  4. Signal update — linked_finding_id + processed = true written back.
 *  5. Risk exposure  — open risks in the matched domain are flagged with
 *       exposure_flagged = TRUE, exposure_signal_id = signal.id
 *     (only risks not already flagged are touched; existing flags preserved).
 *  6. Posture snapshot — a new snapshot is computed and persisted for the
 *     affected org so posture reflects the new finding immediately.
 *     Failure here is non-fatal: the signal and finding are already committed.
 *
 * MATCHING RULES
 * --------------
 * Finding creation is intentionally gated on a platform entity match.
 * A CVE with no known vendor in the platform is stored as a signal but
 * does not generate a finding — it would be noise with no addressable owner.
 * If both a vendor and an AI system match, the vendor match takes precedence
 * for domain routing (Vendor Risk). Both entity IDs are returned for context.
 *
 * NO_MATCH SIGNALS
 * ----------------
 * If no vendor or AI system match is found, the signal is still marked
 * processed = true. It remains visible in the signal list and can be
 * manually linked later via a PATCH if the entity is added to the platform.
 */

import type { PoolClient } from "pg";
import { pgElevated } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { canonicalizeVendorName } from "./vendorNameCanonical.js";
import { buildSignalFindingTitle, resolveSignalDomain } from "./signalFindingShape.js";
import { signalApplicabilityEnabled } from "./signalApplicabilityFeatureFlag.js";
import { signalFindingCveDedupEnabled } from "./signalFindingCveDedupFlag.js";
import { runSignalApplicabilityShadow, backingAssetIds } from "./signalApplicabilityShadowRunner.js";
import { extractSignalProductEvidence } from "./signalProductEvidence.js";
import { upsertCanonicalProduct } from "./canonicalProductStore.js";
import { intelligenceEventsEnabled } from "./signals/intelligenceEventsFeatureFlag.js";
// Runtime-safe despite the emitter's type-only import back into this module:
// the MatcherResult import is erased at compile time, so the runtime edge is
// one-directional (this module → emitter → dispatcher).
import { createSignalWebhookBatcher } from "./signalWebhookEmitter.js";
import { resolveEventIdForSignal } from "./signals/eventSignalResolver.js";
import {
  computePosture,
  FALLBACK_CONTEXT,
  severityToPriority,
  type DbFindingForPosture,
  type OrgContext
} from "./postureComputation.js";
import {
  buildWorkflowSignalBreakdown,
  buildScoringRationaleExtension
} from "./workflowScoringIntegration.js";
import { vendorCriticalityToSignals } from "./inventoryToSignals.js";
import { sqlFindingActive } from "./metricDefinitions.js";
import {
  computeRiskScore,
  DEFAULT_WEIGHTS,
  type RiskScoringWeights
} from "./riskScoring.js";
import {
  scoreObligationMatch,
  MIN_MATCH_SCORE,
  SUGGESTION_CAP
} from "./signalTargetMatching.js";
import { ASSET_TYPE_SPECS } from "./assetRegistry.js";
import { assetRegistryEnabled } from "./assetRegistryFeatureFlag.js";

/** EAR Phase 2: cap on generic-asset-matcher suggestions per signal (canonical-
 * exact only, so >1 means several same-named entities — cap defensively). */
const ASSET_SUGGESTION_CAP = 10;
import {
  fuzzyVendorMatchEnabled,
  vendorNameSimilarity,
  FUZZY_VENDOR_MIN_SCORE,
  FUZZY_VENDOR_SUGGESTION_CAP,
  FUZZY_VENDOR_MIN_CANONICAL_LEN
} from "./vendorFuzzyMatch.js";
import {
  actionEngineEnabled,
  buildFindingActionDraft,
  buildRiskActionDraft,
  buildObligationActionDraft
} from "./actionRecommendationEngine.js";
import { runLlmControlMatcherForSignal } from "./llmControlMatcher.js";
import { enqueueApplicabilityReassessment } from "./applicabilityReassessment.js";
import { resolveSlaDueDateWith } from "./findingSlaPolicyRules.js";
import { createAlertBatcher } from "./alerting/alertService.js";
import { matcherAlertsEnabled } from "./alerting/matcherAlertsFeatureFlag.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CyberSignalRecord = {
  id: string;
  organization_id: string;
  source: string;
  signal_type: string;
  severity: string;
  normalized_summary: string;
  affected_vendor: string | null;
  affected_cve: string | null;
};

export type ProcessingResult = {
  /** Finding created by this processing run, or null if no entity match. */
  finding: Record<string, unknown> | null;
  /** Vendor ID matched by affected_vendor, or null. */
  matched_vendor_id: string | null;
  /** AI system ID matched by affected_vendor, or null. */
  matched_ai_system_id: string | null;
  /** Number of open risk rows that had exposure_flagged set to TRUE. */
  risks_flagged: number;
  /** Whether the posture snapshot was successfully recomputed after processing. */
  posture_recalculated: boolean;
};

/**
 * Result of running runMatcherForSignal — the matcher-only pipeline
 * (phases 1-3 of the original processSignal). Returned to the caller
 * for logging / audit / further processing.
 */
export type MatcherResult = {
  /** Vendor ID matched by affected_vendor (for orgId), or null. */
  matched_vendor_id: string | null;
  /** AI system ID matched by affected_vendor (for orgId), or null. */
  matched_ai_system_id: string | null;
  /** Finding row created by phase 3a, or null when no match. */
  finding: Record<string, unknown> | null;
  /** True only when phase 3a INSERTed a NEW finding this run; false when the D-14 guard reused the existing (org, signal) finding. Alerting keys off this so a re-fired signal never re-notifies. */
  finding_was_created: boolean;
  /** Suggestion row created by phase 3b. NULL when no match OR when ON CONFLICT skipped (a row already exists in any state per the partial unique index). */
  suggestion_id: string | null;
  /** Score, integer [0, 100], from computeRiskScore. NULL when no match (so no suggestion was attempted) OR when the suggestion existed already and was skipped. */
  match_score: number | null;
  /** Domain assigned by routing (Vendor Risk / AI Governance / Vulnerability / etc.). */
  domain: string;
  /** Which vendor/AI matcher branch fired. 'no_match' when neither vendor nor ai_system matched. NOTE: obligation generation (GAP-1) is independent of this field — it never sets an obligation value here; see obligation_suggestion_ids. */
  matched_branch: "vendor_name_ilike" | "ai_system_name_ilike" | "no_match";
  /** IDs of signal_match_suggestions written by the obligation branch (target_type 'obligation'). Empty when the branch did not fire or wrote nothing (below threshold / all deduped). */
  obligation_suggestion_ids: string[];
  /** Number of open risk rows this run set exposure_flagged=TRUE on (phase 5, org-scoped). 0 when no open risk in the signal's domain needed flagging. */
  risks_flagged: number;
};

// ---------------------------------------------------------------------------
// Post-commit alerting
// ---------------------------------------------------------------------------

/**
 * Real-time alert for a finding phase 3a NEWLY created on the processSignal
 * path (API ingest + briefScheduler). The worker fan-out paths (runPipeline,
 * kevPoller) already run their own per-cycle coalescing batcher; this closes
 * the same gap for the remaining matcher invocation path using the SAME
 * flag (`SECURELOGIC_MATCHER_ALERTS_ENABLED`), the SAME batcher, and the SAME
 * post-commit rule — a rollback must never have emailed about a finding that
 * doesn't exist. Batch-of-one, mirroring the webhook batcher at this seam.
 *
 * finding_was_created gates re-fires (the D-14 guard's reused finding must not
 * re-notify); the per-(user, finding) ledger inside the batcher is the durable
 * backstop. Fire-and-forget: an alert failure never breaks signal processing.
 */
function alertOnCreatedSignalFinding(orgId: string, result: MatcherResult): void {
  if (!matcherAlertsEnabled()) return;
  if (!result.finding_was_created || result.finding === null) return;
  const severity = result.finding.severity as string;
  if (severity !== "Critical" && severity !== "High") return;

  const batcher = createAlertBatcher("critical_finding", "signal_processing");
  batcher.add(orgId, {
    findingId: result.finding.id as string,
    title: (result.finding.title as string) ?? "",
    severity,
    domain: (result.finding.domain as string | null) ?? null
  });
  batcher.flush().catch((err) => {
    logger.warn(
      { event: "signal_processing_alert_flush_failed", orgId, err },
      "Signal-processing alert flush failed (non-fatal)"
    );
  });
}

// ---------------------------------------------------------------------------
// Domain routing
// ---------------------------------------------------------------------------

/**
 * Determine the finding domain from signal context.
 *
 * Vendor match always wins over AI system match for domain routing since a
 * vendor signal is scoped to Vendor Risk regardless of whether the vendor
 * also runs AI systems. AI Governance only applies when the matched entity
 * is exclusively an AI system (no vendor record matched the name).
 */
// resolveSignalDomain and the finding-title rules now live in the pure, shared
// signalFindingShape module: user promotion (POST /api/findings/from-signal) must
// shape a Finding from a signal the SAME way this path does, or the same signal
// would read as two different findings depending on who created it.


// ---------------------------------------------------------------------------
// canonicalizeVendorName — the single canonical normalizer, now defined in the
// pure, side-effect-free module `vendorNameCanonical.ts` (C1) and RE-EXPORTED
// here so every existing `import { canonicalizeVendorName } from
// "./cyberSignalProcessingService.js"` keeps working unchanged. There remains
// exactly one normalizer (imported at the top of this file for internal use).
// ---------------------------------------------------------------------------
export { canonicalizeVendorName } from "./vendorNameCanonical.js";

// ---------------------------------------------------------------------------
// runMatcherForSignal
// ---------------------------------------------------------------------------

/**
 * Run the matcher-only pipeline for a (signal, org) pair.
 *
 * Phases 1-3 of the historical processSignal pipeline:
 *   1. Vendor ILIKE match  (org-scoped)
 *   2. AI system ILIKE match (org-scoped, only if no vendor match)
 *   3a. Finding INSERT (preserves existing reader contract — five live
 *       readers still depend on findings WHERE source_type='cyber_signal'
 *       per package 3.5 investigation. Dual-write is the steady state
 *       until reader migration ships separately.)
 *   3b. Suggestion INSERT into signal_match_suggestions, with match_score
 *       computed at write time via computeRiskScore using the org's
 *       weights (DEFAULT_WEIGHTS fallback when no row), and match_metadata
 *       populated with { source, matched_branch, matched_string } for
 *       queue UI display.
 *
 * SHARED IMPLEMENTATION (do not duplicate)
 * ----------------------------------------
 * processSignal calls into this function. Worker fan-out
 * (runPipeline.ts, kevPoller.ts) calls it directly per (signal, org) pair.
 * The matcher logic exists in exactly one place. Resist any temptation
 * to inline a "lightweight matcher" elsewhere "for performance" or
 * "because the worker is different" — code paths converge here so
 * behavior stays unified and a fix in one place fixes all callers.
 *
 * IDEMPOTENCY CONTRACT
 * --------------------
 * The suggestion INSERT uses ON CONFLICT against the partial unique
 * index idx_signal_match_suggestions_unique_pending, which excludes
 * accepted and dismissed rows. Re-firing the matcher on the same
 * (org, signal, target) pair when a pending suggestion already exists
 * is a no-op (DO NOTHING returns 0 rows; suggestion_id is null in the
 * result). After accept/dismiss, the matcher CAN re-suggest on a
 * subsequent call — Package 1's deliberate design choice for accidental-
 * dismissal recovery and weight-change re-surfacing.
 *
 * Note: the findings INSERT is guarded (D-14, #693): NOT EXISTS on
 * (org, source_type='cyber_signal', source_id) — one finding per
 * (org, signal), the IE-AD-7 grain. A re-fire reuses the existing
 * finding row for downstream linkage instead of minting a duplicate.
 * The durable backstop (partial unique index) rides a follow-up
 * approved migration; dedup_hash on cyber_signals still blocks
 * signal-level repeats upstream.
 *
 * TRANSACTION OWNERSHIP
 * ---------------------
 * Optional `client` parameter. When provided (typically by processSignal
 * which has its own BEGIN/COMMIT spanning phases 1-5), this function
 * uses the caller's client and does NOT issue BEGIN/COMMIT — the
 * matcher writes are atomic with the caller's surrounding work.
 * When omitted (typically by worker fan-out), this function opens its
 * own connection and tx for matcher-only writes.
 *
 * @param signal The fully committed cyber_signals row to match against.
 * @param orgId  The organization to match for. Must be a valid org id;
 *               for global signals the worker fan-out passes each active
 *               org's id in turn.
 * @param externalClient Optional pg client to use; if provided, the caller
 *                       owns the BEGIN/COMMIT and rollback semantics.
 * @returns A MatcherResult describing the match outcome.
 */
export async function runMatcherForSignal(
  signal: CyberSignalRecord,
  orgId: string,
  externalClient?: PoolClient
): Promise<MatcherResult> {
  const { id: signalId, signal_type: signalType, severity } = signal;

  // Phase-5 invariant: risk-exposure flagging (below) is org-scoped
  // (WHERE organization_id = $org). runMatcherForSignal must never be called for
  // a global row — the worker fans global signals out per concrete org, and
  // processSignal short-circuits org_id IS NULL before reaching here. Assert it so
  // a future global caller fails loudly rather than silently flagging the wrong
  // (or every) org's risks.
  if (!orgId) {
    throw new Error(
      "runMatcherForSignal: non-null orgId required (org-scoped phases incl. phase-5 risk-exposure flagging); global signals must fan out per-org"
    );
  }

  const ownsTransaction = externalClient === undefined;
  const client: PoolClient = externalClient ?? (await pgElevated.connect());

  let matchedVendorId: string | null = null;
  let matchedVendorName: string | null = null;
  let matchedVendorCriticality: string | null = null;
  let matchedAiSystemId: string | null = null;
  let matchedAiSystemName: string | null = null;
  let matchedAiSystemCriticality: string | null = null;
  let createdFinding: Record<string, unknown> | null = null;
  let findingWasCreated = false;
  let suggestionId: string | null = null;
  let matchScore: number | null = null;
  let matchedBranch: MatcherResult["matched_branch"] = "no_match";

  // GAP-1 accumulator — obligation suggestion IDs (target_type 'obligation').
  // Independent of the vendor/AI branch above.
  const obligationSuggestionIds: string[] = [];

  // Phase-5 accumulator — count of risks this run set exposure_flagged=TRUE on.
  let risksFlagged = 0;

  try {
    if (ownsTransaction) await client.query("BEGIN");

    // ---------------------------------------------------------------
    // 1. Vendor matching — active vendors only, case-insensitive name.
    //    Selects criticality so phase 3b can compute the score in a
    //    single read per match (no extra round-trip).
    // ---------------------------------------------------------------

    // Canonical of the signal vendor, computed once. Empty (e.g. a vendor
    // string that is all punctuation) never matches — guard so it cannot
    // collide with a degenerate canonical.
    const canonicalSignalVendor =
      signal.affected_vendor !== null
        ? canonicalizeVendorName(signal.affected_vendor)
        : "";

    // EAR Phase 2 (ARCHITECTURE.md §1.4 chokepoint 2): WHICH types are
    // name-matched risk targets comes from the asset-type spec, not per-type
    // hard-codes. vendor/ai_system are spec-true → the two live branches below
    // behave identically; enterprise_entities-backed spec targets
    // (application/database) are handled by the generic registry branch
    // further down, which activates only behind SECURELOGIC_ASSET_REGISTRY_ENABLED.
    const nameCanonicalTargets = new Set(
      Object.values(ASSET_TYPE_SPECS)
        .filter((s) => s.isRiskTarget && s.matchStrategy === "name_canonical")
        .map((s) => s.type)
    );

    // Hoisted so the Phase-2 fuzzy branch (below) can reuse the org's active
    // vendor rows without a second query. Populated only when we enter the
    // exact branch — which is exactly the precondition for fuzzy to run.
    let activeVendorRows: Array<{ id: string; name: string; criticality: string | null }> = [];

    if (canonicalSignalVendor !== "" && nameCanonicalTargets.has("vendor")) {
      // Normalization-then-exact: fetch this org's active vendors and compare
      // canonical forms in TS using the SAME canonicalizeVendorName as the
      // signal side. SQL regexp_replace would be a SECOND implementation of the
      // transform and risk asymmetry; one helper guarantees both sides match.
      const vendorResult = await client.query<{
        id: string;
        name: string;
        criticality: string | null;
      }>(
        `
        SELECT id, name, criticality
        FROM vendors
        WHERE organization_id = $1
          AND status = 'active'
        ORDER BY name ASC
        `,
        [orgId]
      );
      activeVendorRows = vendorResult.rows;

      const row = vendorResult.rows.find(
        (v) => canonicalizeVendorName(v.name) === canonicalSignalVendor
      );

      if (row) {
        matchedVendorId = row.id;
        matchedVendorName = row.name;
        matchedVendorCriticality = row.criticality;
        // Branch label retained verbatim for MatcherResult type stability
        // (the mechanism is now canonical-exact, not ILIKE).
        matchedBranch = "vendor_name_ilike";
      }

      // ---------------------------------------------------------------
      // 2. AI system matching — only if no vendor match.
      // ---------------------------------------------------------------

      if (matchedVendorId === null && nameCanonicalTargets.has("ai_system")) {
        // Same canonical-exact approach as the vendor branch, against the
        // org's AI systems. Reuses canonicalSignalVendor (already non-empty here).
        const aiResult = await client.query<{
          id: string;
          name: string;
          criticality: string | null;
        }>(
          `
          SELECT id, name, criticality
          FROM ai_systems
          WHERE organization_id = $1
          ORDER BY name ASC
          `,
          [orgId]
        );

        const row = aiResult.rows.find(
          (a) => canonicalizeVendorName(a.name) === canonicalSignalVendor
        );

        if (row) {
          matchedAiSystemId = row.id;
          matchedAiSystemName = row.name;
          matchedAiSystemCriticality = row.criticality;
          matchedBranch = "ai_system_name_ilike";
        }
      }
    }

    const hasVendorMatch = matchedVendorId !== null;
    const hasAiMatch = matchedAiSystemId !== null;
    const domain = resolveSignalDomain(signalType, hasVendorMatch, hasAiMatch);

    // ---------------------------------------------------------------
    // 3a. Finding creation — only when a platform entity is matched.
    //     Dual-write with the suggestion INSERT below; preserved for
    //     reader compatibility (dashboard, recent-signals UI, posture).
    // ---------------------------------------------------------------

    if (hasVendorMatch || hasAiMatch) {
      const entityName = matchedVendorName ?? matchedAiSystemName ?? "Unknown";
      const priority = severityToPriority(severity);

      // Same shared builder user promotion uses. This branch always has a matched
      // entity (it is the condition for creating a finding here at all), so the
      // wording is the one this path has always produced.
      const findingTitle = buildSignalFindingTitle({
        signalType,
        severity,
        affectedCve: signal.affected_cve,
        entity: hasVendorMatch
          ? { kind: "vendor", name: entityName }
          : { kind: "ai_system", name: entityName },
      });

      // CVE-grain duplicate guard — DARK behind
      // SECURELOGIC_SIGNAL_FINDING_CVE_DEDUP_ENABLED (see
      // signalFindingCveDedupFlag.ts for the staging evidence). The D-14 guard
      // below is per-signal, so a second SOURCE reporting the same CVE (or a
      // re-ingested signal under a fresh id) mints a duplicate open finding
      // for the same vulnerability+entity. When ON and the signal carries a
      // CVE, an ACTIVE cyber_signal finding for the same (org, CVE, matched
      // entity) is reused instead — the same reuse contract as the D-14
      // re-fire path, so downstream linkage attaches to the original row.
      // Entity match is via the machine-asserted link tables, with a
      // lower(affected_vendor) fallback for findings that predate 3c's
      // link-writing. CVE-less signals keep per-signal grain untouched.
      let cveGrainReused: Record<string, unknown> | null = null;
      if (signalFindingCveDedupEnabled() && signal.affected_cve !== null) {
        const dedupLinkTable = hasVendorMatch
          ? "signal_vendor_links"
          : "signal_ai_system_links";
        const dedupLinkFk = hasVendorMatch ? "vendor_id" : "ai_system_id";
        const dedupTargetId = hasVendorMatch ? matchedVendorId : matchedAiSystemId;
        const dupResult = await client.query(
          `
          SELECT f.id, f.organization_id, f.assessment_id, f.source_type,
                 f.source_id, f.title, f.description, f.severity, f.domain,
                 f.priority, f.status, f.created_at, f.updated_at
            FROM findings f
            JOIN cyber_signals s ON s.id = f.source_id
           WHERE f.organization_id = $1
             AND f.source_type = 'cyber_signal'
             AND ${sqlFindingActive("f.operational_status")}
             AND s.affected_cve = $2
             AND (
               EXISTS (
                 SELECT 1 FROM ${dedupLinkTable} l
                  WHERE l.organization_id = $1
                    AND l.signal_id = f.source_id
                    AND l.${dedupLinkFk} = $3::uuid
                    AND l.deleted_at IS NULL
               )
               OR (s.affected_vendor IS NOT NULL
                   AND lower(s.affected_vendor) = lower($4))
             )
           ORDER BY f.created_at ASC
           LIMIT 1
          `,
          [orgId, signal.affected_cve, dedupTargetId, signal.affected_vendor]
        );
        cveGrainReused = dupResult.rows[0] ?? null;
      }

      if (cveGrainReused !== null) {
        createdFinding = cveGrainReused;
        findingWasCreated = false;
      } else {
      // SLA policy (20260903): automated signal findings get an org-policy
      // due date at creation (client keeps the read inside this transaction).
      const slaDueDate = await resolveSlaDueDateWith(client, orgId, severity);
      // D-14 idempotency guard: re-firing the matcher on the same signal must
      // not mint a second finding (this INSERT is live in production; see the
      // duplicate acknowledgment above). One finding per (org, signal) —
      // the same grain IE-AD-7 chose for intelligence_event findings. The
      // NOT EXISTS runs inside this transaction; the matcher processes a
      // signal serially per org, so this closes the observed re-fire path.
      // A partial unique index (like idx_findings_intelligence_event_unique)
      // is the durable backstop and rides a follow-up approved migration.
      const findingResult = await client.query(
        `
        INSERT INTO findings (
          organization_id,
          assessment_id,
          source_type,
          source_id,
          title,
          description,
          severity,
          domain,
          priority,
          status,
          due_date
        )
        SELECT $1, NULL, 'cyber_signal', $2::uuid, $3, $4, $5, $6, $7, 'open', $8
        WHERE NOT EXISTS (
          SELECT 1 FROM findings
           WHERE organization_id = $1
             AND source_type = 'cyber_signal'
             AND source_id = $2::uuid
        )
        RETURNING
          id,
          organization_id,
          assessment_id,
          source_type,
          source_id,
          title,
          description,
          severity,
          domain,
          priority,
          status,
          created_at,
          updated_at
        `,
        [
          orgId,
          signalId,
          findingTitle,
          signal.normalized_summary,
          severity,
          domain,
          priority,
          slaDueDate
        ]
      );

      createdFinding = findingResult.rows[0] ?? null;
      findingWasCreated = createdFinding !== null;
      }

      // Re-fire on an already-processed signal: reuse the existing finding so
      // downstream linkage (suggestion, GAP-3 action — both already idempotent
      // on their own keys) attaches to the original row instead of a duplicate.
      if (createdFinding === null) {
        const existingFinding = await client.query(
          `
          SELECT id, organization_id, assessment_id, source_type, source_id,
                 title, description, severity, domain, priority, status,
                 created_at, updated_at
            FROM findings
           WHERE organization_id = $1
             AND source_type = 'cyber_signal'
             AND source_id = $2::uuid
           ORDER BY created_at ASC
           LIMIT 1
          `,
          [orgId, signalId]
        );
        createdFinding = existingFinding.rows[0] ?? null;
      }

      // GAP-3: action recommendation — turn a high-signal finding into a
      // concrete "what to do next". Flag-gated (OFF by default) and threshold-
      // gated (Critical/High only) so the action queue stays meaningful. Built
      // from the in-scope finding fields (not the RETURNING shape) + the new
      // finding id. Idempotent: ON CONFLICT against idx_actions_generated_finding
      // (partial on action_type marker) so re-processing never duplicates, and a
      // user's manual finding-action never collides.
      if (createdFinding !== null && actionEngineEnabled()) {
        const actionDraft = buildFindingActionDraft({
          findingId: createdFinding.id as string,
          title: findingTitle,
          severity,
          priority
        });

        if (actionDraft !== null) {
          await client.query(
            `
            INSERT INTO actions (
              organization_id, title, description, action_type,
              source_type, source_id, priority, status
            )
            VALUES ($1, $2, $3, $4, $5, $6::uuid, $7, 'open')
            ON CONFLICT (organization_id, source_type, source_id)
              WHERE action_type = 'auto_finding_remediation'
              DO NOTHING
            `,
            [
              orgId,
              actionDraft.title,
              actionDraft.description,
              actionDraft.action_type,
              actionDraft.source_type,
              actionDraft.source_id,
              actionDraft.priority
            ]
          );
        }
      }

      // ---------------------------------------------------------------
      // 3b. Suggestion INSERT + score compute.
      //     Reads org weights (DEFAULT_WEIGHTS fallback), computes the
      //     score, and INSERTs into signal_match_suggestions with
      //     ON CONFLICT against the partial unique index. Conflict =
      //     pending suggestion already exists; DO NOTHING returns 0
      //     rows and we leave suggestion_id null in the result.
      // ---------------------------------------------------------------

      const targetType: "vendor" | "ai_system" = hasVendorMatch
        ? "vendor"
        : "ai_system";
      const targetId = (hasVendorMatch ? matchedVendorId : matchedAiSystemId)!;
      const targetCriticality = hasVendorMatch
        ? matchedVendorCriticality
        : matchedAiSystemCriticality;
      const matchedString = signal.affected_vendor;

      const weightsResult = await client.query<{
        entity_criticality_weights: RiskScoringWeights["entity_criticality_weights"];
        obligation_priority_weights: RiskScoringWeights["obligation_priority_weights"];
        severity_weights: RiskScoringWeights["severity_weights"];
      }>(
        `SELECT entity_criticality_weights, obligation_priority_weights, severity_weights
           FROM risk_scoring_weights
          WHERE organization_id = $1
          LIMIT 1`,
        [orgId]
      );
      const weights: RiskScoringWeights =
        (weightsResult.rowCount ?? 0) === 0
          ? DEFAULT_WEIGHTS
          : {
              entity_criticality_weights:
                weightsResult.rows[0]!.entity_criticality_weights,
              obligation_priority_weights:
                weightsResult.rows[0]!.obligation_priority_weights,
              severity_weights: weightsResult.rows[0]!.severity_weights
            };

      const scoreResult = computeRiskScore({
        signal: { severity, source: signal.source },
        entity: {
          type: targetType,
          criticality: targetCriticality
        },
        weights
      });
      matchScore = scoreResult.score;

      const matchMetadata = {
        source: signal.source,
        matched_branch: matchedBranch,
        matched_string: matchedString
      };

      // NOT EXISTS across ALL states, not ON CONFLICT against the pending partial
      // unique index. Step 3c below auto-accepts this suggestion, and the partial
      // index only constrains PENDING rows — so an ON CONFLICT guard would stop
      // seeing the accepted row and happily insert a fresh duplicate on every
      // matcher re-run. (The fuzzy and obligation branches stay pending, so they
      // keep the ON CONFLICT form, which is still correct for them.)
      const suggestionInsert = await client.query<{ id: string }>(
        `
        INSERT INTO signal_match_suggestions (
          organization_id, signal_id, target_type, target_id,
          match_reason, match_score, match_metadata
        )
        SELECT $1, $2::uuid, $3, $4::uuid, $5, $6, $7::jsonb
         WHERE NOT EXISTS (
           SELECT 1 FROM signal_match_suggestions e
            WHERE e.organization_id = $1 AND e.signal_id = $2::uuid
              AND e.target_type = $3 AND e.target_id = $4::uuid
         )
        RETURNING id
        `,
        [
          orgId,
          signalId,
          targetType,
          targetId,
          matchedBranch,
          matchScore,
          JSON.stringify(matchMetadata)
        ]
      );

      if ((suggestionInsert.rowCount ?? 0) > 0) {
        suggestionId = suggestionInsert.rows[0]!.id;
      } else {
        // ON CONFLICT fired — pending suggestion already exists.
        // Score not refreshed (recompute endpoint exists for that).
        // Surface as null suggestion_id; matcher is idempotent.
        matchScore = null;
      }

      // ---------------------------------------------------------------
      // 3c. Confirm the deterministic match as a LINK.
      //
      //     Phase 1 matched by canonical-EXACT equality — not a fuzzy or scored
      //     guess. That match is the PRECONDITION of this finding existing at
      //     all: step 3a only creates the finding `if (hasVendorMatch ||
      //     hasAiMatch)`, and titles it "<CVE> affects vendor: <name>".
      //
      //     Recording that association only as a *suggestion* made the product
      //     contradict itself. findingContextResolver.affected() and
      //     findingEntitySearch read the signal_*_links tables and nothing else,
      //     so the Decision Workspace rendered "Vendors (0) — No affected
      //     vendors" directly beneath a finding whose own title named the vendor,
      //     and a Risk Findings search for "Microsoft" returned zero against
      //     1000+ Microsoft findings. Only a human clicking Accept in the queue
      //     could fix it — for every signal finding ever generated.
      //
      //     A proposal is something we might be wrong about. This is not: it is
      //     the reason the finding exists. So it is written as a link. Genuinely
      //     uncertain matches — the fuzzy vendor branch (Phase 2) and the scored
      //     obligation branch (GAP-1) — stay suggest-only below.
      //
      //     A human DISMISSAL is final: if someone rejected this pairing we do
      //     not resurrect it, and no link is written.
      // ---------------------------------------------------------------

      const linkTable =
        targetType === "vendor" ? "signal_vendor_links" : "signal_ai_system_links";
      const linkFk = targetType === "vendor" ? "vendor_id" : "ai_system_id";

      // Write the link. The NOT EXISTS clause is the dismissal guard: if a human
      // rejected this pairing, no link is ever written. created_by_user_id NULL
      // marks it machine-asserted (the human accept routes stamp the actor).
      // ON CONFLICT makes it idempotent against the live partial unique index.
      await client.query(
        `
        INSERT INTO ${linkTable} (organization_id, signal_id, ${linkFk}, note, created_by_user_id)
        SELECT $1, $2::uuid, $3::uuid, $4, NULL::uuid
         WHERE NOT EXISTS (
           SELECT 1 FROM signal_match_suggestions d
            WHERE d.organization_id = $1 AND d.signal_id = $2::uuid
              AND d.target_type = $5 AND d.target_id = $3::uuid
              AND d.dismissed_at IS NOT NULL
         )
        ON CONFLICT (organization_id, signal_id, ${linkFk})
          WHERE deleted_at IS NULL
          DO NOTHING
        `,
        [orgId, signalId, targetId, `Auto-confirmed: ${matchedBranch}`, targetType]
      );

      // Reflect the confirmation on the suggestion so the review queue does not
      // ask a human to re-approve what the matcher already asserted. The row is
      // KEPT (not deleted) as the audit trail of how the link came to exist;
      // accepted_by_user_id stays NULL to mark it machine-accepted. The join
      // resolves the link id (whether just inserted or pre-existing), and the
      // pending-only predicate means a dismissed row is never touched.
      await client.query(
        `
        UPDATE signal_match_suggestions s
           SET accepted_at = NOW(), accepted_link_id = l.id
          FROM ${linkTable} l
         WHERE l.organization_id = s.organization_id
           AND l.signal_id = s.signal_id
           AND l.${linkFk} = s.target_id
           AND l.deleted_at IS NULL
           AND s.organization_id = $1 AND s.signal_id = $2::uuid
           AND s.target_type = $3 AND s.target_id = $4::uuid
           AND s.accepted_at IS NULL AND s.dismissed_at IS NULL
        `,
        [orgId, signalId, targetType, targetId]
      );
    }

    // ---------------------------------------------------------------
    // Phase 2: fuzzy vendor matching — SUGGEST-ONLY, OFF by default.
    //
    // Runs ONLY when the exact (Phase-1) branch found no vendor AND no AI
    // match, and only when the flag is enabled. Writes signal_match_suggestions
    // (target_type 'vendor') for token-similar vendors so a human can accept or
    // dismiss — it NEVER creates a finding or flags a risk (a false fuzzy match
    // must not reach the customer). Mirrors the GAP-1 obligation branch's
    // suggest-only posture and ON CONFLICT idempotency. MatcherResult is
    // intentionally unchanged (no field for fuzzy ids — telemetry is deferred;
    // suggestions are observable directly via match_reason='vendor_fuzzy_match').
    //
    // Short canonicals are exact-only (MIN_CANONICAL_LEN) so short/common names
    // cannot Jaccard-collide. Candidates reuse activeVendorRows (already fetched).
    // ---------------------------------------------------------------
    if (
      fuzzyVendorMatchEnabled() &&
      matchedVendorId === null &&
      matchedAiSystemId === null &&
      canonicalSignalVendor.length >= FUZZY_VENDOR_MIN_CANONICAL_LEN
    ) {
      const fuzzyCandidates = activeVendorRows
        .map((v) => ({
          vendor: v,
          score: vendorNameSimilarity(
            canonicalSignalVendor,
            canonicalizeVendorName(v.name)
          )
        }))
        // No upper bound: the fuzzy branch only runs when the exact branch found
        // no canonical-equal vendor, so a score of 100 here means same token SET
        // but different string (word-order variant) — a legitimate fuzzy win.
        .filter((c) => c.score >= FUZZY_VENDOR_MIN_SCORE)
        .sort((a, b) => b.score - a.score)
        .slice(0, FUZZY_VENDOR_SUGGESTION_CAP);

      for (const cand of fuzzyCandidates) {
        await client.query(
          `
          INSERT INTO signal_match_suggestions (
            organization_id, signal_id, target_type, target_id,
            match_reason, match_score, match_metadata
          )
          VALUES ($1, $2::uuid, 'vendor', $3::uuid, 'vendor_fuzzy_match', $4, $5::jsonb)
          ON CONFLICT (organization_id, signal_id, target_type, target_id)
            WHERE accepted_at IS NULL AND dismissed_at IS NULL
            DO NOTHING
          `,
          [
            orgId,
            signalId,
            cand.vendor.id,
            cand.score,
            JSON.stringify({
              source: signal.source,
              matched_branch: "vendor_fuzzy",
              matched_string: signal.affected_vendor,
              candidate_name: cand.vendor.name,
              similarity: cand.score
            })
          ]
        );
      }
    }

    // ---------------------------------------------------------------
    // EAR Phase 2: generic asset matcher — the §1.3 plane convergence.
    // SUGGEST-ONLY and FLAG-GATED (SECURELOGIC_ASSET_REGISTRY_ENABLED,
    // default off → byte-for-byte inert in prod). Canonical-exact match of
    // the signal's affected_vendor against enterprise_entities-backed
    // registry assets whose spec is a name_canonical risk target
    // (application/database today; Phase-3 types join by spec flip alone).
    // Writes signal_match_suggestions with target_type='asset' + asset_id
    // (EAR-AD-3 — the quartet enum stops growing). No findings, no links,
    // no risk flagging — the accept path for 'asset' targets is a Phase-3
    // decision (link-store shape).
    // ---------------------------------------------------------------
    if (assetRegistryEnabled() && canonicalSignalVendor !== "") {
      // Every spec-declared name_canonical risk target that is NOT one of the
      // two live branches (vendor/ai_system) matches here, uniformly through
      // the registry view: application/database (enterprise_entities-backed)
      // and the Phase-3a detail-backed types (cloud_resource/endpoint/api/
      // identity_system). Registered rows only (a.id join) — the suggestion
      // target is the Tier-0 asset id.
      const registryTargets = Object.values(ASSET_TYPE_SPECS)
        .filter(
          (s) =>
            s.isRiskTarget &&
            s.matchStrategy === "name_canonical" &&
            s.backingKind !== "vendors" &&
            s.backingKind !== "ai_systems"
        )
        .map((s) => s.type);
      if (registryTargets.length > 0) {
        const assetRows = await client.query<{ asset_id: string; asset_type: string; name: string }>(
          `
          SELECT a.id AS asset_id, a.asset_type, rv.name
          FROM assets a
          JOIN asset_registry_v rv
            ON rv.asset_id = a.id AND rv.organization_id = a.organization_id
          WHERE a.organization_id = $1
            AND a.asset_type = ANY($2)
            AND rv.status = 'active'
          ORDER BY rv.name ASC
          `,
          [orgId, registryTargets]
        );
        const assetMatches = assetRows.rows
          .filter((r) => canonicalizeVendorName(r.name) === canonicalSignalVendor)
          .slice(0, ASSET_SUGGESTION_CAP);
        for (const m of assetMatches) {
          await client.query(
            `
            INSERT INTO signal_match_suggestions (
              organization_id, signal_id, target_type, target_id, asset_id,
              match_reason, match_score, match_metadata
            )
            VALUES ($1, $2::uuid, 'asset', $3::uuid, $3::uuid, 'asset_name_canonical', 100, $4::jsonb)
            ON CONFLICT (organization_id, signal_id, target_type, target_id)
              WHERE accepted_at IS NULL AND dismissed_at IS NULL
              DO NOTHING
            `,
            [
              orgId,
              signalId,
              m.asset_id,
              JSON.stringify({
                source: signal.source,
                matched_branch: "asset_generic",
                matched_string: signal.affected_vendor,
                candidate_name: m.name,
                asset_type: m.asset_type
              })
            ]
          );
        }
        if (assetMatches.length > 0) {
          logger.info(
            { event: "signal_asset_suggestions_created", organizationId: orgId, signalId, count: assetMatches.length },
            "Generic asset matcher wrote registry-target suggestions"
          );
        }

        // ERG convergence C3 — SHADOW (SECURELOGIC_SIGNAL_APPLICABILITY_ENABLED,
        // default off). Runs the NEW product→tenant-asset resolution ALONGSIDE the
        // legacy asset match and records counts-only convergence telemetry. It
        // writes nothing customer-visible and is fully try/catch-isolated, so the
        // authoritative legacy path is unaffected; flag-off is byte-identical.
        if (signalApplicabilityEnabled()) {
          try {
            await runSignalApplicabilityShadow(
              client,
              orgId,
              { productHint: signal.affected_vendor, cve: signal.affected_cve, grain: "asset" },
              assetMatches.map((m) => m.asset_id)
            );
          } catch (err) {
            logger.warn(
              { event: "signal_applicability_shadow_failed", organizationId: orgId, signalId, grain: "asset", err },
              "signal applicability shadow failed (non-fatal — legacy path authoritative)"
            );
          }
        }
      }
    }

    // ERG convergence C4 (ADR-0003 D1) — persist the PRODUCT the signal is about.
    //
    // The product was never lost, only never read: cisaKevAdapter stores the whole feed
    // entry in `raw_payload` but persists only `vendorProject` as affected_vendor. So the
    // pipeline had a vendor and no product — and ERG R2 forbids inferring `affected` from
    // vendor identity alone. That is precisely why the shadow runner had to feed the
    // vendor name in AS the product just to produce candidates.
    //
    // Here the real product token is extracted and upserted into the ORG-NEUTRAL
    // canonical_products (+ alias) — which is what the tenant-asset resolver's evidence
    // path joins against. Writes NO tenant data, so ERIP-AD-8 is not engaged. Flag-gated
    // and try/catch-isolated: a failure here must never break ingestion, and the legacy
    // path stays authoritative until C8.
    if (signalApplicabilityEnabled()) {
      try {
        // raw_payload is not on CyberSignalRecord (the matcher's narrow view), and
        // widening it would silently yield NO product evidence for any caller that
        // forgot to populate it. Read it from the row instead — one query, flag-gated.
        const payloadRow = await client.query<{ raw_payload: Record<string, unknown> | null }>(
          `SELECT raw_payload FROM cyber_signals WHERE id = $1::uuid`,
          [signalId]
        );
        const evidence = extractSignalProductEvidence({
          source: signal.source,
          affected_vendor: signal.affected_vendor,
          affected_cve: signal.affected_cve,
          raw_payload: payloadRow.rows[0]?.raw_payload ?? null,
        });
        if (evidence) {
          await upsertCanonicalProduct(client, {
            identity: {
              vendor: evidence.vendor_raw,
              product: evidence.product_raw,
              // Deliberately NO cve: a product is a product regardless of which
              // vulnerability is being assessed today, and canonical_key embeds the cve —
              // passing it would mint a fresh product row per advisory.
              cve: null,
            },
            aliases: [{ raw: evidence.product_raw, source: evidence.evidence_ref }],
          });
        }
      } catch (err) {
        logger.warn(
          { event: "canonical_product_upsert_failed", organizationId: orgId, signalId, err },
          "canonical product upsert failed (non-fatal — legacy path authoritative)"
        );
      }
    }

    // ERG convergence C3b — SHADOW at the vendor / ai_system → tenant-asset grain
    // (SECURELOGIC_SIGNAL_APPLICABILITY_ENABLED, default off). Measures whether the
    // legacy vendor/ai_system match resolves to the SAME canonical tenant asset(s)
    // as the product→asset resolver. legacy side = the matched entity's Tier-0
    // backing asset(s); shadow side = resolve the entity's own name product→asset.
    // Read-only, writes NOTHING (no applicability, vendor/ai links, findings, or
    // registry writes); try/catch-isolated; flag-off byte-identical; legacy
    // linkage stays authoritative. Unresolved/ambiguous are recorded, never guessed.
    if (signalApplicabilityEnabled()) {
      try {
        if (matchedVendorId !== null && matchedVendorName !== null) {
          const legacy = await backingAssetIds(client, orgId, "vendors", matchedVendorId);
          await runSignalApplicabilityShadow(
            client,
            orgId,
            { productHint: matchedVendorName, cve: signal.affected_cve, grain: "vendor" },
            legacy
          );
        }
        if (matchedAiSystemId !== null && matchedAiSystemName !== null) {
          const legacy = await backingAssetIds(client, orgId, "ai_systems", matchedAiSystemId);
          await runSignalApplicabilityShadow(
            client,
            orgId,
            { productHint: matchedAiSystemName, cve: signal.affected_cve, grain: "ai_system" },
            legacy
          );
        }
      } catch (err) {
        logger.warn(
          { event: "signal_applicability_shadow_failed", organizationId: orgId, signalId, grain: "vendor_ai", err },
          "vendor/ai-system applicability shadow failed (non-fatal — legacy path authoritative)"
        );
      }
    }

    // ---------------------------------------------------------------
    // GAP-1: obligation suggestion generation.
    //
    // Independent of the vendor/AI branch above — keyed on signal_type,
    // NOT affected_vendor. SUGGEST-ONLY: writes signal_match_suggestions
    // (target_type 'obligation') and nothing else — no findings, no risk
    // flagging, never the link tables (the accept→link path handles
    // those). Dedup + idempotency via the same ON CONFLICT partial-unique
    // predicate as above.
    //
    // The signal→control branch was removed from this package: token
    // overlap can't bridge CVE-feed vocabulary to control names; it is
    // being rebuilt as a separate LLM-based package.
    //
    // Obligation matching privileges regulation identity (does the signal
    // cite this obligation's source_regulation?) with domain as a weak
    // tiebreaker — see scoreObligationMatch.
    // ---------------------------------------------------------------
    if (signalType === "regulatory_change") {
      const obligationCandidates = await client.query<{
        id: string;
        source_regulation: string | null;
        domain: string | null;
      }>(
        `SELECT id, source_regulation, domain
           FROM obligations
          WHERE organization_id = $1
            AND status = 'active'`,
        [orgId]
      );

      // Regulation identity is matched against the signal's CONTENT
      // (normalized_summary), not the feed `source` — otherwise every
      // NIST-sourced signal would "cite" every NIST obligation.
      const signalText = signal.normalized_summary;
      const scored = obligationCandidates.rows
        .map((o) => ({
          id: o.id,
          label: o.source_regulation ?? o.domain ?? "",
          score: scoreObligationMatch(signalText, o)
        }))
        .filter((c) => c.score >= MIN_MATCH_SCORE)
        .sort((a, b) => b.score - a.score)
        .slice(0, SUGGESTION_CAP);

      for (const cand of scored) {
        const ins = await client.query<{ id: string }>(
          `
          INSERT INTO signal_match_suggestions (
            organization_id, signal_id, target_type, target_id,
            match_reason, match_score, match_metadata
          )
          VALUES ($1, $2::uuid, 'obligation', $3::uuid, 'obligation_domain_match', $4, $5::jsonb)
          ON CONFLICT (organization_id, signal_id, target_type, target_id)
            WHERE accepted_at IS NULL AND dismissed_at IS NULL
            DO NOTHING
          RETURNING id
          `,
          [
            orgId,
            signalId,
            cand.id,
            cand.score,
            JSON.stringify({
              source: signal.source,
              matched_branch: "obligation_domain_match",
              matched_string: cand.label
            })
          ]
        );
        if ((ins.rowCount ?? 0) > 0) obligationSuggestionIds.push(ins.rows[0]!.id);
      }

      // GAP-3 increment 3: action recommendation for the TOP, high-confidence
      // obligation match only (suggest-only obligation matches are many + lower-
      // confidence; one action per signal keeps the queue meaningful). Flag-gated
      // OFF by default + idempotent via idx_actions_generated_obligation.
      if (actionEngineEnabled() && scored.length > 0) {
        const topObligation = scored[0]!;
        const obligationActionDraft = buildObligationActionDraft(
          topObligation.id,
          topObligation.label,
          topObligation.score
        );
        if (obligationActionDraft !== null) {
          await client.query(
            `
            INSERT INTO actions (
              organization_id, title, description, action_type,
              source_type, source_id, priority, status
            )
            VALUES ($1, $2, $3, $4, $5, $6::uuid, $7, 'open')
            ON CONFLICT (organization_id, source_type, source_id)
              WHERE action_type = 'auto_obligation_review'
              DO NOTHING
            `,
            [
              orgId,
              obligationActionDraft.title,
              obligationActionDraft.description,
              obligationActionDraft.action_type,
              obligationActionDraft.source_type,
              obligationActionDraft.source_id,
              obligationActionDraft.priority
            ]
          );
        }
      }

      if (scored.length > 0) {
        logger.info(
          {
            event: "matcher_obligation_suggestions",
            orgId,
            signalId,
            targetType: "obligation",
            candidates: scored.length,
            written: obligationSuggestionIds.length
          },
          "Matcher wrote obligation suggestions"
        );
      }
    }

    // ---------------------------------------------------------------
    // 5. Risk exposure flagging (org-scoped; runs unconditionally, like
    //    finding/suggestion creation above — only the action it spawns is
    //    flag-gated). Flag open risks in the matched domain that are not
    //    already exposure-flagged. Only touches risks that need updating.
    //    Lifted here from processSignal so the worker fan-out (which calls
    //    runMatcherForSignal directly) gets risk-exposure flagging + the
    //    risk→action generator natively, inside this same transaction.
    // ---------------------------------------------------------------

    const riskExposureResult = await client.query<{ id: string }>(
      `
      UPDATE risks
      SET exposure_flagged   = TRUE,
          exposure_signal_id = $1::uuid,
          updated_at         = NOW()
      WHERE organization_id    = $2
        AND status             = 'open'
        AND domain             = $3
        AND exposure_flagged   = FALSE
      RETURNING id
      `,
      [signalId, orgId, domain]
    );

    risksFlagged = riskExposureResult.rowCount ?? 0;

    // GAP-3 increment 2: action recommendation for newly exposure-flagged risks.
    // One "review exposed risk" action per risk just flagged by THIS signal.
    // Flag-gated (OFF by default) + idempotent via idx_actions_generated_risk
    // (partial on the 'auto_risk_exposure' marker) so re-processing / a manual
    // risk-action never collides. Same posture as the finding→action generator.
    if (actionEngineEnabled() && riskExposureResult.rows.length > 0) {
      for (const flaggedRisk of riskExposureResult.rows) {
        const riskActionDraft = buildRiskActionDraft(flaggedRisk.id, domain);
        const riskActionInsert = await client.query(
          `
          INSERT INTO actions (
            organization_id, title, description, action_type,
            source_type, source_id, priority, status
          )
          VALUES ($1, $2, $3, $4, $5, $6::uuid, $7, 'open')
          ON CONFLICT (organization_id, source_type, source_id)
            WHERE action_type = 'auto_risk_exposure'
            DO NOTHING
          `,
          [
            orgId,
            riskActionDraft.title,
            riskActionDraft.description,
            riskActionDraft.action_type,
            riskActionDraft.source_type,
            riskActionDraft.source_id,
            riskActionDraft.priority
          ]
        );

        // Telemetry only: fire ONLY when a row was actually written (rowCount 0
        // means ON CONFLICT DO NOTHING skipped an existing action). No control-
        // flow effect — the INSERT/gating/dedup are unchanged.
        if ((riskActionInsert.rowCount ?? 0) > 0) {
          logger.info(
            {
              event: "risk_exposure_action_generated",
              orgId,
              riskId: flaggedRisk.id,
              domain
            },
            "Generated auto_risk_exposure action for exposure-flagged risk"
          );
        }
      }
    }

    // Event-native linkage (IE-AD-11): stamp the canonical Intelligence Event on
    // every suggestion this signal produced, so the accept/dismiss workflow and
    // all linkage services reference the authoritative model. Flag-gated: NULL
    // (legacy, signal-only) when off. Best-effort — never blocks the matcher.
    if (intelligenceEventsEnabled()) {
      try {
        const eventId = await resolveEventIdForSignal(client, signalId, signal.affected_cve);
        if (eventId) {
          await client.query(
            `UPDATE signal_match_suggestions
                SET intelligence_event_id = $1
              WHERE organization_id = $2 AND signal_id = $3 AND intelligence_event_id IS NULL`,
            [eventId, orgId, signalId]
          );
        }
      } catch (err) {
        logger.warn(
          { event: "matcher_event_link_failed", orgId, signalId, err },
          "Failed to stamp canonical event on suggestions (non-fatal)"
        );
      }
    }

    if (ownsTransaction) await client.query("COMMIT");

    logger.info(
      {
        event: "matcher_run_for_signal",
        orgId,
        signalId,
        matchedVendorId,
        matchedAiSystemId,
        matchedBranch,
        findingId: createdFinding !== null ? (createdFinding.id as string) : null,
        suggestionId,
        matchScore,
        domain,
        risksFlagged
      },
      "Matcher run for signal"
    );

    const result: MatcherResult = {
      matched_vendor_id: matchedVendorId,
      matched_ai_system_id: matchedAiSystemId,
      finding: createdFinding,
      finding_was_created: findingWasCreated,
      suggestion_id: suggestionId,
      match_score: matchScore,
      domain,
      matched_branch: matchedBranch,
      obligation_suggestion_ids: obligationSuggestionIds,
      risks_flagged: risksFlagged
    };

    // No alerting here: the worker fan-out callers (runPipeline, kevPoller) own
    // per-cycle coalescing batchers, and the processSignal caller alerts after
    // ITS commit. finding_was_created on the result carries the truth they need.
    return result;
  } catch (err) {
    if (ownsTransaction) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore rollback error
      }
    }
    // When we don't own the tx, the caller's catch handles ROLLBACK.
    // Either way, propagate so the caller can decide policy.
    throw err;
  } finally {
    if (ownsTransaction) client.release();
  }
}

// ---------------------------------------------------------------------------
// processSignal
// ---------------------------------------------------------------------------

/**
 * Run the full processing pipeline for a newly ingested (unprocessed) signal.
 *
 * Calls runMatcherForSignal for phases 1-3 (matcher + dual-write of finding
 * and suggestion) and phase 5 (risk-exposure flagging + risk→action), then
 * layers phase 4 (signal-row update) inside the same transaction. Phase 6
 * (posture snapshot) runs in a separate tx after the main one commits and is
 * non-fatal.
 *
 * GLOBAL-SIGNAL EDGE CASE
 * -----------------------
 * When the source signal has organization_id IS NULL, this function
 * short-circuits before phase 4. Global signals fan out to N orgs (via
 * the worker path's per-org runMatcherForSignal calls); they have no
 * single linked finding, no single org's posture to recompute, and no
 * single org's risks to flag. Phases 4-6 do not apply.
 *
 * The invariant being enforced is row-based, not caller-based: any
 * caller passing a row with org_id IS NULL gets the same skip semantics.
 * If a future API path posts a global signal directly, the invariant
 * holds without modification.
 *
 * @param signal  The fully committed cyber_signals row.
 * @returns       A ProcessingResult describing every side effect applied.
 */
export async function processSignal(
  signal: CyberSignalRecord
): Promise<ProcessingResult> {
  const { id: signalId, organization_id: orgId, signal_type: _signalType } = signal;

  let matcherResult: MatcherResult | null = null;
  let risksUpdated = 0;

  // Global signals: matcher does not apply at the processSignal level.
  // The worker fan-out is responsible for per-org matching of global
  // signals; processSignal's phases 4-6 are org-scoped and would error
  // or produce nonsense if executed against org_id IS NULL.
  if (orgId === null) {
    logger.info(
      { event: "process_signal_global_skipped", signalId },
      "processSignal called on global signal (org_id IS NULL); phases 4-6 do not apply"
    );
    return {
      finding: null,
      matched_vendor_id: null,
      matched_ai_system_id: null,
      risks_flagged: 0,
      posture_recalculated: false
    };
  }

  const client = await pgElevated.connect();

  try {
    await client.query("BEGIN");

    // Phases 1-3 + phase 5 (risk-exposure flagging + risk→action) run inside
    // runMatcherForSignal. Shared client so those writes are atomic with the
    // phase-4 signal-row update below.
    matcherResult = await runMatcherForSignal(signal, orgId, client);

    const createdFinding = matcherResult.finding;
    const domain = matcherResult.domain;

    // ---------------------------------------------------------------
    // 4. Update signal: linked_finding_id + processed = true
    //
    //    NOTE on the linked_finding_id skip invariant: this column
    //    only makes sense for org-scoped signals (one signal, one
    //    org, one finding). For global signals (org_id IS NULL on
    //    the source row) the invariant is "no single linked
    //    finding" — N orgs can each produce their own finding via
    //    the worker fan-out, and there is no canonical winner. The
    //    short-circuit at the top of processSignal enforces this:
    //    we only reach this UPDATE for org-scoped signals. The
    //    invariant is row-based, not caller-based, so any future
    //    path through processSignal honors the same skip.
    // ---------------------------------------------------------------

    await client.query(
      `
      UPDATE cyber_signals
      SET processed         = TRUE,
          linked_finding_id = $1,
          updated_at        = NOW()
      WHERE id = $2
        AND organization_id = $3
      `,
      [
        createdFinding !== null ? (createdFinding.id as string) : null,
        signalId,
        orgId
      ]
    );

    // Phase 5 (risk-exposure flagging) + the risk→action generator now run
    // INSIDE runMatcherForSignal (above), atomically on this same shared client,
    // so the worker fan-out gets them natively. The count is surfaced on the
    // MatcherResult; no separate UPDATE risks here.
    risksUpdated = matcherResult.risks_flagged;

    // ECL R3 (Slice 7): enqueue an applicability-reassessment job for this
    // (org, signal) on the SAME client — committed iff the processing commits.
    // Self-gating: a zero-DB no-op unless SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED,
    // so this line is inert in every environment where the ECL is dark.
    await enqueueApplicabilityReassessment(client, orgId, {
      type: "signal_changed",
      signal_id: signalId
    });

    await client.query("COMMIT");

    // Wave-1 (DS-15): emit AFTER the commit so a rollback can never produce a
    // phantom event. Route path = a batch of one; no-op while wave 1 is dark.
    const webhookBatch = createSignalWebhookBatcher("signal_processing");
    webhookBatch.add(orgId, signalId, matcherResult);
    webhookBatch.flush();

    // Real-time alert (flag-gated, coalesced) for a finding created inside OUR
    // transaction — same post-commit rule as the webhook emit above. This is
    // the API-ingest/briefScheduler counterpart of the worker fan-out batchers.
    alertOnCreatedSignalFinding(orgId, matcherResult);

    logger.info(
      {
        event: "cyber_signal_processed",
        orgId,
        signalId,
        matchedVendorId: matcherResult.matched_vendor_id,
        matchedAiSystemId: matcherResult.matched_ai_system_id,
        findingId: createdFinding !== null ? (createdFinding.id as string) : null,
        suggestionId: matcherResult.suggestion_id,
        matchScore: matcherResult.match_score,
        domain,
        risksUpdated
      },
      "Cyber signal processed"
    );
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback error
    }

    logger.error(
      { event: "cyber_signal_processing_failed", signalId, orgId, err },
      "Cyber signal processing failed — signal stored but not fully processed"
    );

    // Return a partial result rather than throwing — the signal row is
    // committed and the caller can surface this in the response.
    return {
      finding: null,
      matched_vendor_id: null,
      matched_ai_system_id: null,
      risks_flagged: 0,
      posture_recalculated: false
    };
  } finally {
    client.release();
  }

  // ---------------------------------------------------------------
  // 6. Posture snapshot trigger (non-fatal)
  //    Run after the main transaction commits so the new finding
  //    is visible to the snapshot query.
  // ---------------------------------------------------------------

  let postureRecalculated = false;
  const createdFinding = matcherResult?.finding ?? null;

  if (createdFinding !== null) {
    try {
      await computeAndPersistPostureSnapshot(orgId);
      postureRecalculated = true;
    } catch (postureErr) {
      logger.warn(
        {
          event: "cyber_signal_posture_snapshot_failed",
          orgId,
          signalId,
          err: postureErr
        },
        "Posture snapshot trigger failed after signal processing — snapshot will be stale until next explicit recompute"
      );
    }
  }

  // ---------------------------------------------------------------
  // 7. GAP-1: LLM control matcher (suggest-only, AFTER commit, non-fatal).
  //    Self-gated (flag OFF by default + relevant signal-type + Critical/High
  //    + API key) so it no-ops cheaply with zero spend when disabled. Never
  //    throws. Runs here, post-commit, because an LLM call must not block the
  //    matcher transaction.
  // ---------------------------------------------------------------
  await runLlmControlMatcherForSignal(
    {
      id: signalId,
      signal_type: signal.signal_type,
      severity: signal.severity,
      normalized_summary: signal.normalized_summary
    },
    orgId
  );

  return {
    finding: createdFinding,
    matched_vendor_id: matcherResult?.matched_vendor_id ?? null,
    matched_ai_system_id: matcherResult?.matched_ai_system_id ?? null,
    risks_flagged: risksUpdated,
    posture_recalculated: postureRecalculated
  };
}

// ---------------------------------------------------------------------------
// computeAndPersistPostureSnapshot
// ---------------------------------------------------------------------------

/**
 * Compute and persist a posture snapshot for the given org.
 *
 * Replicates the computation performed by POST /api/posture/snapshot but
 * is callable programmatically after signal processing so that posture
 * reflects the new finding without requiring a separate API call.
 *
 * Uses the same engines (computePosture, buildWorkflowSignalBreakdown) and
 * the same upsert pattern (one snapshot per org per calendar day).
 */
async function computeAndPersistPostureSnapshot(orgId: string): Promise<void> {
  // Fetch org profile for context-weighted scoring.
  const orgProfileResult = await pgElevated.query<{
    regulated: boolean;
    handles_pii: boolean;
    safety_critical: boolean;
    scale: string;
  }>(
    `
    SELECT regulated, handles_pii, safety_critical, scale
    FROM organizations
    WHERE id = $1
    `,
    [orgId]
  );

  let orgContext: OrgContext;

  if ((orgProfileResult.rowCount ?? 0) === 0) {
    logger.warn(
      { event: "posture_trigger_org_not_found", orgId },
      "Org profile not found for posture trigger — using fallback context"
    );
    orgContext = FALLBACK_CONTEXT;
  } else {
    const row = orgProfileResult.rows[0]!;
    const validScales = new Set(["Small", "Medium", "Enterprise"]);
    orgContext = {
      regulated: row.regulated,
      handlesPII: row.handles_pii,
      safetyCritical: row.safety_critical,
      scale: validScales.has(row.scale) ? (row.scale as OrgContext["scale"]) : "Small"
    };
  }

  // Parallel fetch: findings, risks, signal breakdown, active treatment
  // count, active-vendor inventory. Inventory feeds the synthetic
  // Vendor Risk signals — same pattern as postureSnapshot.ts. Both
  // pipelines must stay in sync; otherwise the worker and the
  // signal-processing path produce different scores for the same org.
  const [
    findingsResult,
    risksResult,
    findingBreakdownResult,
    treatedRiskResult,
    vendorInventoryResult,
  ] = await Promise.all([
      // Metric Contract: posture computes over the ACTIVE finding population,
      // matching postureSnapshot.ts (which documents why `status = 'open'` was
      // retired there). This path had drifted — a snapshot written after signal
      // ingestion used a smaller population than the worker/route snapshot for
      // the same org, so domain counts could not reconcile with the dashboard's
      // Active headline depending on which writer ran last.
      pgElevated.query<DbFindingForPosture>(
        `
        SELECT id, title, domain, severity
        FROM findings
        WHERE organization_id = $1
          AND ${sqlFindingActive()}
        `,
        [orgId]
      ),
      // Engine consumes RESIDUAL per Decision §4. Mirrors the same
      // change in postureSnapshot.ts; both pipelines must stay in sync.
      pgElevated.query<{ id: string; title: string; domain: string; residual_rating: string }>(
        `
        SELECT id, title, domain, residual_rating
        FROM risks
        WHERE organization_id = $1
          AND status = 'open'
          AND residual_rating IS NOT NULL
        `,
        [orgId]
      ),
      pgElevated.query<{ source_type: string; count: string }>(
        `
        SELECT source_type, COUNT(*)::text AS count
        FROM findings
        WHERE organization_id = $1
          AND ${sqlFindingActive()}
        GROUP BY source_type
        `,
        [orgId]
      ),
      pgElevated.query<{ count: string }>(
        `
        SELECT COUNT(DISTINCT r.id)::text AS count
        FROM risks r
        JOIN risk_treatments rt
          ON rt.risk_id = r.id
         AND rt.organization_id = $1
         AND rt.status IN ('not_started', 'in_progress')
        WHERE r.organization_id = $1
          AND r.status = 'open'
        `,
        [orgId]
      ),
      pgElevated.query<{ id: string; criticality: string }>(
        `
        SELECT id, criticality FROM vendors
        WHERE organization_id = $1
          AND status = 'active'
          AND criticality IS NOT NULL
        `,
        [orgId]
      ),
    ]);

  const riskSignals: DbFindingForPosture[] = risksResult.rows.map((r) => ({
    id: r.id,
    title: r.title,
    domain: r.domain,
    severity: r.residual_rating
  }));

  const vendorInventorySignals = vendorCriticalityToSignals(
    vendorInventoryResult.rows
  );

  // Domain-count reconciliation ruling (2026-07-17): risk + inventory signals
  // feed SCORING only — passed to computePosture separately (mirrors
  // postureSnapshot.ts; both pipelines must stay in sync) so headline counts
  // cover unique active findings exactly once, under their primary domain.
  const auxSignals = [...riskSignals, ...vendorInventorySignals];
  const riskSignalCount = riskSignals.length;

  // Count open and overdue actions.
  const actionCountResult = await pgElevated.query<{
    open_count: string;
    overdue_count: string;
  }>(
    `
    SELECT
      COUNT(*)::text AS open_count,
      COUNT(*) FILTER (
        WHERE due_date < CURRENT_DATE
          AND status NOT IN ('closed', 'accepted')
      )::text AS overdue_count
    FROM actions
    WHERE organization_id = $1
      AND status NOT IN ('closed', 'accepted')
    `,
    [orgId]
  );

  const actionRow = actionCountResult.rows[0];
  const openActionCount = actionRow != null ? parseInt(actionRow.open_count, 10) : 0;
  const overdueActionCount =
    actionRow != null ? parseInt(actionRow.overdue_count, 10) : 0;

  const risksWithActiveTreatment = parseInt(
    treatedRiskResult.rows[0]?.count ?? "0",
    10
  );

  const signalBreakdown = buildWorkflowSignalBreakdown(
    findingBreakdownResult.rows,
    riskSignalCount,
    risksWithActiveTreatment
  );

  const rationaleExtension = buildScoringRationaleExtension(signalBreakdown);
  const computed = computePosture(
    findingsResult.rows,
    openActionCount,
    overdueActionCount,
    orgContext,
    riskSignalCount,
    auxSignals
  );

  const enrichedRationale = { ...computed.computation_rationale, ...rationaleExtension };

  // Persist snapshot + domain scores.
  const snapshotClient = await pgElevated.connect();

  try {
    await snapshotClient.query("BEGIN");

    const snapshotResult = await snapshotClient.query(
      `
      INSERT INTO posture_snapshots (
        organization_id,
        snapshot_date,
        overall_score,
        overall_severity,
        open_finding_count,
        open_action_count,
        overdue_action_count,
        computation_rationale
      )
      VALUES ($1, CURRENT_DATE, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (organization_id, snapshot_date) DO UPDATE SET
        overall_score        = EXCLUDED.overall_score,
        overall_severity     = EXCLUDED.overall_severity,
        open_finding_count   = EXCLUDED.open_finding_count,
        open_action_count    = EXCLUDED.open_action_count,
        overdue_action_count = EXCLUDED.overdue_action_count,
        computation_rationale = EXCLUDED.computation_rationale,
        created_at           = NOW()
      RETURNING id
      `,
      [
        orgId,
        computed.overall_score,
        computed.overall_severity,
        computed.open_finding_count,
        computed.open_action_count,
        computed.overdue_action_count,
        JSON.stringify(enrichedRationale)
      ]
    );

    const snapshotId = snapshotResult.rows[0]?.id as string | undefined;

    if (snapshotId == null) {
      throw new Error("posture_snapshot_upsert_returned_no_row");
    }

    // Replace domain scores for this snapshot.
    await snapshotClient.query(
      `DELETE FROM domain_scores WHERE posture_snapshot_id = $1`,
      [snapshotId]
    );

    if (computed.domain_scores.length > 0) {
      const domainValues: unknown[] = [];
      const domainPlaceholders: string[] = [];

      computed.domain_scores.forEach((ds, i) => {
        const base = i * 6;
        domainPlaceholders.push(
          `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`
        );
        domainValues.push(snapshotId, ds.domain, ds.score, ds.severity, ds.finding_count, ds.rationale);
      });

      await snapshotClient.query(
        `
        INSERT INTO domain_scores (
          posture_snapshot_id, domain, score, severity, finding_count, rationale
        )
        VALUES ${domainPlaceholders.join(", ")}
        `,
        domainValues
      );
    }

    await snapshotClient.query("COMMIT");

    logger.info(
      {
        event: "posture_snapshot_triggered_by_signal",
        orgId,
        snapshotId,
        overallScore: computed.overall_score,
        domainCount: computed.domain_scores.length
      },
      "Posture snapshot recomputed after signal ingestion"
    );
  } catch (err) {
    try {
      await snapshotClient.query("ROLLBACK");
    } catch {
      // ignore
    }
    throw err;
  } finally {
    snapshotClient.release();
  }
}
