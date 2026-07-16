/**
 * signalFindingShape.ts — how a cyber signal becomes a Finding: its title and its
 * domain. Pure and dependency-free, so both writers can share ONE definition and
 * be unit-tested without a database.
 *
 * There are two writers, and they must agree:
 *
 *   1. the automated path (cyberSignalProcessingService) — fires during ingestion,
 *      and ONLY when the signal matches a platform entity (a vendor or an AI
 *      system the org actually has);
 *   2. user promotion (POST /api/findings/from-signal) — a human reading the
 *      Intelligence Brief decides this signal matters to them.
 *
 * (2) exists because (1) leaves a hole: a signal that matches no entity in the
 * registry never becomes a Finding, so the reader of a Brief item had nothing to
 * open, decide, or remediate. The whole Decision Workspace sat behind an input the
 * customer could not produce. Promotion is the missing hop, and the ENTITY-LESS
 * case below is the one it needs — which is exactly why the title/domain rules
 * live here rather than being copied into the route with a slightly different
 * wording that would make the same signal read as two different findings.
 */

import { signalTypePhraseCapitalized } from "./signals/signalTypeLabels.js";

/** The entity a signal matched in the org's registry, if any. */
export type SignalEntityMatch =
  | { kind: "vendor"; name: string }
  | { kind: "ai_system"; name: string }
  | null;

export interface SignalFindingInput {
  signalType: string;
  severity: string;
  /** Normalized to CVE-YYYY-NNNNN upstream; null when the signal names no CVE. */
  affectedCve: string | null;
  entity: SignalEntityMatch;
}

/**
 * The Finding title for a signal.
 *
 * Walkthrough item 6 (July-15): the previous wordings interpolated the raw
 * signal_type enum — "Cyber signal (patch_advisory): …" — straight into a
 * customer-visible, PERSISTED title. Titles now use the shared customer
 * vocabulary (signalTypeLabels). Existing findings keep their old wording (dedup
 * keys on (org, source), never on title); new/updated ones read in customer
 * language.
 */
export function buildSignalFindingTitle(input: SignalFindingInput): string {
  const { signalType, severity, affectedCve, entity } = input;

  if (entity !== null) {
    if (affectedCve !== null) {
      const noun = entity.kind === "vendor" ? "vendor" : "AI system";
      return `${affectedCve} affects ${noun}: ${entity.name}`;
    }
    return `${signalTypePhraseCapitalized(signalType)}: ${entity.name} — ${severity} severity`;
  }

  // No matched entity — the promotion case. The automated path never reaches here
  // (it does not create a finding at all without a match), so there is no legacy
  // wording to preserve. Name the signal itself, since there is no entity to name.
  if (affectedCve !== null) return `${affectedCve} — requires assessment`;
  return `${signalTypePhraseCapitalized(signalType)} — ${severity} severity`;
}

/**
 * The Finding domain for a signal.
 *
 * A matched vendor wins over AI: a vendor signal is scoped to Vendor Risk
 * regardless of whether that vendor also runs AI systems. AI Governance applies
 * only when the matched entity is exclusively an AI system.
 */
export function resolveSignalDomain(
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
