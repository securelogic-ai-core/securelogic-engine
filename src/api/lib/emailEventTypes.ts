/**
 * emailEventTypes.ts — what a provider event MEANS, in one place.
 *
 * Extracted so the webhook that acts on an event and the evidence endpoint that
 * reports on it cannot drift apart. Evidence computed by a different rule than
 * the one enforcement uses is worse than no evidence: it reads as proof while
 * describing a system that does not exist.
 */

/**
 * Does this event type cause a suppression to be written?
 *
 * DEFECT THIS FIXES (found 2026-08-11 while building the P1-2 evidence
 * endpoint): the previous predicate tested `type.includes("complaint")`, but
 * the event Resend actually sends is **`email.complained`** — which does not
 * contain the substring "complaint" ("complained" ends -ed, not -t). Both the
 * production and staging webhooks are subscribed to `email.complained`, so
 * those events have been arriving and being stored in `email_provider_events`
 * for the life of the integration while never writing an `email_suppressions`
 * row.
 *
 * The consequence is not cosmetic: a recipient marks our mail as spam, we
 * record the event, we never suppress them, and we keep mailing them. Repeat
 * complaints against the same address are precisely what degrades sender
 * reputation for every customer on the shared domain.
 *
 * Matching on the stem "complain" covers `email.complained`, a bare
 * "complaint", and any future tense the provider chooses. No other Resend event
 * type (`sent`, `delivered`, `delivery_delayed`, `bounced`, `opened`,
 * `clicked`, `failed`) contains it, so the widened match cannot over-suppress.
 *
 * `failed` is deliberately NOT a suppression event: it reports a send that did
 * not go out, not a recipient who cannot or will not receive.
 */
export function isSuppressionEvent(type: string): boolean {
  return type.includes("bounce") || type.includes("complain");
}
