/**
 * findingClosureError.ts — turn the engine's closure refusal into something a human can act on.
 *
 * The engine refuses to close a Finding whose remediation is incomplete with a stable,
 * machine-readable code (`close_requires_remediation_complete`) plus a count. That code is a
 * CONTRACT for integrations — and it is also, verbatim, what every one of our own closure
 * controls used to put on screen, because each of them rendered `body.error` raw. A customer
 * clicking "Close" was shown a snake_case identifier, or (on the Finding detail card, whose
 * form ignored the result entirely) nothing whatsoever: the button simply did not work.
 *
 * One mapper, used by every closure surface, so the message cannot drift between them:
 *   - /findings                (FindingCard)
 *   - /ai-systems/[id]         (FindingCard)
 *   - /obligations/[id]        (FindingCard)
 *   - /controls/[id]           (FindingCard)
 *   - /findings/[id]           (status card)
 *   - /findings/[id]           (Decision Workspace status + decision controls)
 *
 * Server-side enforcement is unchanged and remains the authority. This is presentation: the
 * UI may hide or relabel a control it knows will be refused, but it never decides closure.
 */

export const CLOSE_REQUIRES_REMEDIATION_COMPLETE = "close_requires_remediation_complete";

/** What the engine sends back on a refusal. */
export interface ClosureRefusalBody {
  error?: string;
  open_actions?: number;
  message?: string;
}

/** What a closure control gets back, ready to render. */
export interface FindingActionError {
  /** Customer-safe. Never a raw error code. */
  error: string;
  /** Blocking remediation items, when the refusal was a closure gate. */
  blockingActions?: number;
  /** Deep link to the Remediation tab of the Finding that is blocked. */
  remediationHref?: string;
}

export function remediationHref(findingId: string): string {
  return `/findings/${findingId}?tab=remediation`;
}

/**
 * Map an engine error body to a customer-safe action error.
 *
 * The count is included because "finish the remediation" is not actionable on its own —
 * "2 items" tells a customer how much is left, and the link tells them where it is.
 */
export function mapFindingActionError(
  body: ClosureRefusalBody,
  findingId: string,
  fallback = "Failed to update finding"
): FindingActionError {
  if (body?.error === CLOSE_REQUIRES_REMEDIATION_COMPLETE) {
    const count = typeof body.open_actions === "number" ? body.open_actions : undefined;
    const suffix =
      count && count > 0
        ? ` ${count} remediation item${count === 1 ? "" : "s"} remain${count === 1 ? "s" : ""} open.`
        : "";
    return {
      error: `Complete the remaining required remediation before closing this Finding.${suffix}`,
      blockingActions: count,
      remediationHref: remediationHref(findingId),
    };
  }

  // The governance axis's own refusal, for a Finding that is not yet remediated. Same
  // situation, same words — a customer should not have to learn which axis refused them.
  if (body?.error === "invalid_decision_transition") {
    return {
      error: "Complete the remaining required remediation before closing this Finding.",
      remediationHref: remediationHref(findingId),
    };
  }

  return { error: body?.error ? humanize(body.error) : fallback };
}

/**
 * Last line of defence: if an unmapped code ever reaches here, show something readable
 * rather than `some_snake_case_code`. A customer should never see our identifiers.
 */
function humanize(code: string): string {
  if (!/^[a-z0-9_]+$/.test(code)) return code; // already a sentence
  const s = code.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
