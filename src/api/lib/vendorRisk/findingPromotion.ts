/**
 * findingPromotion.ts — which failed controls become Findings, and how severe.
 *
 * The bridge from the assessment to the rest of the platform. A vendor's failed
 * control is not interesting as a questionnaire row; it is interesting as
 * something someone has to DO something about, and `findings` is the canonical
 * object the whole product already uses for that — with owners, due dates,
 * remediation evidence, and the operational-status ladder.
 *
 * ── Why promotion is deterministic ──────────────────────────────────────────
 * An LLM could write a better finding TITLE. It must not decide which controls
 * become findings or how severe they are: that is an applicability-and-severity
 * judgement, and the ratified boundary puts those on the deterministic side.
 * With every AI flag off, an engagement still produces its full finding set.
 *
 * ── Why severity is not just the answer ─────────────────────────────────────
 * The same failed control means different things at different vendors. "No
 * encryption at rest" is Critical at a vendor holding restricted data at mass
 * scale and Moderate at one hosting a brochure site. Severity therefore combines
 * three deterministic inputs — the answer, whether the control was mandatory,
 * and the engagement's inherent BAND — rather than mapping the answer alone.
 *
 * ── Why `not_assessed` promotes and `not_applicable` does not ───────────────
 * The distinction that runs through this whole subsystem. A mandatory control
 * nobody answered is an unanswered mandatory control: a real gap, and one that
 * silently disappears if only failures promote. A control that does not apply is
 * not a gap at all.
 */

import type { RiskBand } from "./riskBands.js";
import type { ResponseStatus } from "./controlEffectiveness.js";
import { METHODOLOGY_VERSION } from "./methodologyVersion.js";

/** Findings severity — the same vocabulary as `findings.severity`. */
export type FindingSeverity = "Critical" | "High" | "Moderate" | "Low";

export type PromotableControl = {
  requirement_id: string;
  reference: string;
  title: string;
  status: ResponseStatus;
  mandatory: boolean;
  /** The vendor's own explanation, if they gave one. */
  notes?: string | null;
};

export type PromotedFinding = {
  requirement_id: string;
  reference: string;
  severity: FindingSeverity;
  title: string;
  description: string;
  recommendation: string;
  /** Why this severity, in plain language. Stored on the finding. */
  severity_rationale: string;
};

/**
 * Severity matrix. Rows are the answer, columns are whether the control was
 * mandatory, and the engagement's inherent band shifts the result.
 *
 * The base grid, before the inherent shift:
 *
 *              mandatory     optional
 *   fail          High        Moderate
 *   not_assessed  Moderate    Low
 *   partial       Moderate    Low
 *
 * `fail` on a mandatory control starts at High rather than Critical because
 * Critical should mean "this vendor is dangerous to us", which depends on what
 * they can reach — and that is what the inherent band supplies.
 */
function baseSeverity(status: ResponseStatus, mandatory: boolean): FindingSeverity | null {
  if (status === "pass" || status === "not_applicable") return null;
  if (status === "fail") return mandatory ? "High" : "Moderate";
  // partial and not_assessed
  return mandatory ? "Moderate" : "Low";
}

const ORDER: FindingSeverity[] = ["Low", "Moderate", "High", "Critical"];

function raise(severity: FindingSeverity, steps: number): FindingSeverity {
  const index = ORDER.indexOf(severity);
  return ORDER[Math.min(ORDER.length - 1, index + steps)]!;
}

/**
 * How far the inherent band lifts a finding.
 *
 * Only Critical lifts, and only by one. A vendor being high-risk does not make
 * every one of their gaps an emergency — inflating severity across the board
 * would make the ranking useless exactly where it is needed most, which is a
 * queue full of Critical findings that a reviewer cannot triage.
 */
const INHERENT_LIFT: Record<RiskBand, number> = {
  Critical: 1,
  High: 0,
  Moderate: 0,
  Low: 0,
};

/**
 * A Low-inherent vendor's findings are capped: their controls simply cannot
 * expose the organisation to a Critical or High outcome, whatever the
 * questionnaire says.
 */
const INHERENT_CAP: Record<RiskBand, FindingSeverity> = {
  Critical: "Critical",
  High: "Critical",
  Moderate: "High",
  Low: "Moderate",
};

function capTo(severity: FindingSeverity, cap: FindingSeverity): FindingSeverity {
  return ORDER.indexOf(severity) > ORDER.indexOf(cap) ? cap : severity;
}

export function severityFor(args: {
  status: ResponseStatus;
  mandatory: boolean;
  inherentBand: RiskBand;
}): { severity: FindingSeverity; rationale: string } | null {
  const base = baseSeverity(args.status, args.mandatory);
  if (!base) return null;

  const lifted = raise(base, INHERENT_LIFT[args.inherentBand]);
  const final = capTo(lifted, INHERENT_CAP[args.inherentBand]);

  const parts: string[] = [
    `A ${args.mandatory ? "mandatory" : "non-mandatory"} control was answered "${args.status.replace("_", " ")}", which rates ${base}.`,
  ];
  if (lifted !== base) {
    parts.push(
      `Raised to ${lifted} because this vendor's inherent risk is ${args.inherentBand} — the same gap carries further at a vendor with this level of access and exposure.`
    );
  }
  if (final !== lifted) {
    parts.push(
      `Capped at ${final} because this vendor's inherent risk is ${args.inherentBand}; their controls cannot expose the organisation beyond that level.`
    );
  }

  return { severity: final, rationale: parts.join(" ") };
}

const STATUS_PHRASE: Record<ResponseStatus, string> = {
  fail: "reported that this control is not in place",
  partial: "reported that this control is only partially implemented",
  not_assessed: "did not answer this control",
  pass: "",
  not_applicable: "",
};

const STATUS_ACTION: Record<ResponseStatus, string> = {
  fail: "Obtain a remediation commitment with a date, or accept the risk explicitly at the appropriate level.",
  partial: "Establish what is missing, and obtain a plan to close the gap.",
  not_assessed: "Ask the vendor to answer this control. An unanswered mandatory control is a gap, not a neutral result.",
  pass: "",
  not_applicable: "",
};

/**
 * Turn an engagement's control responses into findings.
 *
 * Pure. The caller persists them; nothing here writes, and nothing here calls a
 * model.
 */
export function promoteFindings(args: {
  controls: PromotableControl[];
  inherentBand: RiskBand;
  vendorName: string;
}): PromotedFinding[] {
  const out: PromotedFinding[] = [];

  for (const control of args.controls) {
    const severity = severityFor({
      status: control.status,
      mandatory: control.mandatory,
      inherentBand: args.inherentBand,
    });
    if (!severity) continue;

    const description = [
      `${args.vendorName} ${STATUS_PHRASE[control.status]} during their assurance assessment.`,
      control.notes ? `\n\nTheir response: "${control.notes}"` : "",
      `\n\nControl: ${control.reference} — ${control.title}.`,
      control.mandatory
        ? "\n\nThis control was mandatory for this engagement's assessment tier."
        : "",
    ].join("");

    out.push({
      requirement_id: control.requirement_id,
      reference: control.reference,
      severity: severity.severity,
      // The vendor and the control, so a finding is identifiable in a list of
      // two hundred without opening it.
      title: `${args.vendorName}: ${control.reference} — ${control.title}`,
      description,
      recommendation: STATUS_ACTION[control.status],
      severity_rationale: `${severity.rationale} (methodology ${METHODOLOGY_VERSION})`,
    });
  }

  // Most severe first, then by reference so the order is stable across runs —
  // an unstable order makes a re-promotion diff unreadable.
  return out.sort((a, b) => {
    const bySeverity = ORDER.indexOf(b.severity) - ORDER.indexOf(a.severity);
    return bySeverity !== 0 ? bySeverity : a.reference.localeCompare(b.reference);
  });
}
