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
function resolveSignalDomain(
  signalType: string,
  hasVendorMatch: boolean,
  hasAiSystemMatch: boolean
): string {
  if (hasVendorMatch) return "Vendor Risk";
  if (hasAiSystemMatch) return "AI Governance";

  // No platform entity match — route by signal type.
  switch (signalType) {
    case "cve":
    case "patch":
    case "malware":
    case "advisory":
    case "threat_actor":
      return "Vulnerability";
    case "breach":
      return "Vendor Risk";
    case "geopolitical":
    default:
      return "General";
  }
}

// ---------------------------------------------------------------------------
// canonicalizeVendorName (pure — exported for testing)
// ---------------------------------------------------------------------------

/**
 * Trailing legal/entity suffixes stripped during canonicalization. Stripped
 * ONLY when they are the last remaining token(s) — a suffix word that appears
 * mid-name is kept (e.g. "Corp of America" → "corp of america"). The point is
 * to collapse the dominant cross-feed gap: the same brand arrives as a bare
 * name (KEV "Microsoft"), a CPE slug (NVD "microsoft"), and a formal legal name
 * (EDGAR "MICROSOFT CORP"). All must canonicalize identically.
 */
const VENDOR_LEGAL_SUFFIXES = new Set<string>([
  "corp", "corporation", "inc", "incorporated", "llc", "ltd", "limited",
  "plc", "co", "company", "gmbh", "sa", "ag", "nv", "holding", "holdings"
]);

/**
 * Canonicalize a vendor name for EXACT comparison. The SAME function is applied
 * to both the signal's affected_vendor and each candidate vendors.name — using
 * one helper for both sides is the whole point: asymmetric normalization would
 * silently drop true matches.
 *
 * Transform (deterministic, order matters):
 *   1. lowercase
 *   2. every run of non-[a-z0-9] becomes a single space (punctuation → space)
 *   3. trim + collapse whitespace
 *   4. strip TRAILING legal suffix tokens, repeatedly (e.g. "foo holdings inc"
 *      → "foo"), but never the last remaining token (so a vendor literally
 *      named "Co" or "Holdings" survives).
 *
 * This is normalization-then-EXACT: the result is compared with === . There is
 * no wildcard/substring/fuzzy step, so a 2-char canonical ("hp") matches only a
 * vendor whose canonical is exactly "hp" — short names cannot leak. Fuzzy /
 * suggest-only recall is a deferred Phase 2 and deliberately not done here.
 */
export function canonicalizeVendorName(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  if (base === "") return "";

  const tokens = base.split(" ");
  while (tokens.length > 1 && VENDOR_LEGAL_SUFFIXES.has(tokens[tokens.length - 1]!)) {
    tokens.pop();
  }
  return tokens.join(" ");
}

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
 * Note: the findings INSERT today has no ON CONFLICT guard. Re-firing
 * the matcher on the same signal produces duplicate findings rows.
 * Pre-existing bug surfaced in Package 3.5 investigation; deferred to
 * a separate small package per the audit doc §7. Worker fan-out's
 * per-cycle ingestion does not increase risk because dedup_hash on
 * cyber_signals blocks signal repeats.
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

    // Hoisted so the Phase-2 fuzzy branch (below) can reuse the org's active
    // vendor rows without a second query. Populated only when we enter the
    // exact branch — which is exactly the precondition for fuzzy to run.
    let activeVendorRows: Array<{ id: string; name: string; criticality: string | null }> = [];

    if (canonicalSignalVendor !== "") {
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

      if (matchedVendorId === null) {
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

      let findingTitle: string;
      if (hasVendorMatch) {
        findingTitle = signal.affected_cve !== null
          ? `${signal.affected_cve} affects vendor: ${entityName}`
          : `Cyber signal (${signalType}): ${entityName} — ${severity} severity`;
      } else {
        findingTitle = signal.affected_cve !== null
          ? `${signal.affected_cve} affects AI system: ${entityName}`
          : `Cyber signal (${signalType}): ${entityName} — ${severity} severity`;
      }

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
          status
        )
        VALUES ($1, NULL, 'cyber_signal', $2::uuid, $3, $4, $5, $6, $7, 'open')
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
          priority
        ]
      );

      createdFinding = findingResult.rows[0] ?? null;

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

      const suggestionInsert = await client.query<{ id: string }>(
        `
        INSERT INTO signal_match_suggestions (
          organization_id, signal_id, target_type, target_id,
          match_reason, match_score, match_metadata
        )
        VALUES ($1, $2::uuid, $3, $4::uuid, $5, $6, $7::jsonb)
        ON CONFLICT (organization_id, signal_id, target_type, target_id)
          WHERE accepted_at IS NULL AND dismissed_at IS NULL
          DO NOTHING
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

    return {
      matched_vendor_id: matchedVendorId,
      matched_ai_system_id: matchedAiSystemId,
      finding: createdFinding,
      suggestion_id: suggestionId,
      match_score: matchScore,
      domain,
      matched_branch: matchedBranch,
      obligation_suggestion_ids: obligationSuggestionIds,
      risks_flagged: risksFlagged
    };
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

    await client.query("COMMIT");

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
      pgElevated.query<DbFindingForPosture>(
        `
        SELECT id, title, domain, severity
        FROM findings
        WHERE organization_id = $1
          AND status = 'open'
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
          AND status = 'open'
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

  const openFindings = [
    ...findingsResult.rows,
    ...riskSignals,
    ...vendorInventorySignals,
  ];
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
    openFindings,
    openActionCount,
    overdueActionCount,
    orgContext,
    riskSignalCount
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
