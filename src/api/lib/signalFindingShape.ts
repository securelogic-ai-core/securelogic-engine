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
 * The matched-entity wordings are the ones the automated path has always
 * produced and are preserved verbatim — findings already in customers' orgs read
 * this way, and a title is what a person recognizes a finding BY.
 */
export function buildSignalFindingTitle(input: SignalFindingInput): string {
  const { signalType, severity, affectedCve, entity } = input;

  if (entity !== null) {
    if (affectedCve !== null) {
      const noun = entity.kind === "vendor" ? "vendor" : "AI system";
      return `${affectedCve} affects ${noun}: ${entity.name}`;
    }
    return `Cyber signal (${signalType}): ${entity.name} — ${severity} severity`;
  }

  // No matched entity — the promotion case. The automated path never reaches here
  // (it does not create a finding at all without a match), so there is no legacy
  // wording to preserve. Name the signal itself, since there is no entity to name.
  if (affectedCve !== null) return `${affectedCve} — requires assessment`;
  return `Cyber signal (${signalType}) — ${severity} severity`;
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
