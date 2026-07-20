/**
 * queueHandoff.ts — originating-queue handoff context for the Risk Findings →
 * Decision Workspace drill-through (R-19).
 *
 * When a user opens a finding's Decision Workspace from a queue, the workspace
 * states WHERE they came from ("Opened from Finding Explorer" / "Opened from Needs
 * Governance Decision") and offers a link back that restores the exact queue.
 *
 * The whole handoff lives in the URL — `?from=<context>&return=<queue url>` — so a
 * NEW TAB (which has no browser-history or client state to fall back on) shows the
 * banner and can navigate back from the URL alone. Both params are UNTRUSTED client
 * input: `from` is validated against the known contexts and `return` is constrained
 * to a same-origin findings path, so a malformed or hostile value fails safe (no
 * banner / no back-link) and can never become an open redirect. Neither param is
 * ever used for data access — the finding itself is fetched org-scoped server-side.
 *
 * Dependency-free (no React) so it is unit-testable without a DOM harness.
 */

import { opsBucket } from "./workQueues";

/**
 * The browse-queue handoff context — the scalable Finding Explorer queue
 * (FindingsQueueToolbar + FindingCard). It is NOT an ops bucket, so it is handled
 * explicitly here rather than via opsBucket().
 */
export const FINDINGS_QUEUE_CONTEXT = "findings_queue";

/** Upper bound on a legitimate `from` value — every real context is a short slug. */
const MAX_FROM_LEN = 40;
/** Upper bound on a legitimate `return` URL. */
const MAX_RETURN_LEN = 512;

/**
 * Human label for an originating-queue handoff (`?from=`). Returns null for a
 * missing, malformed, or UNRECOGNIZED value so the Decision Workspace fails safe
 * (renders no provenance banner) instead of echoing an attacker-supplied string.
 *
 * - "findings_queue"        → "Finding Explorer"
 * - any OpsBucketId         → that bucket's label (e.g. "Needs Governance Decision")
 * - anything else / junk    → null
 *
 * NOTE: the "findings_queue" SLUG is a URL value carried in `?from=` and is
 * deliberately NOT renamed alongside the label — in-flight links and open tabs
 * must keep resolving. Only the human label changed.
 */
export function queueHandoffLabel(from: string | null | undefined): string | null {
  if (typeof from !== "string" || from.length === 0 || from.length > MAX_FROM_LEN) return null;
  if (from === FINDINGS_QUEUE_CONTEXT) return "Finding Explorer";
  return opsBucket(from)?.label ?? null;
}

/**
 * A safe "back to the originating queue" URL from the `return` handoff param.
 * Accepts ONLY a rooted, same-origin path into the findings surface — never a
 * protocol-relative (`//host`), absolute-URL (`https://…`), backslash-tricked, or
 * off-findings path — so the banner's back-link can't be turned into an open
 * redirect. Returns null when absent or unsafe; callers fall back to a canonical
 * URL derived from `from`.
 */
export function safeQueueReturnUrl(raw: string | null | undefined): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_RETURN_LEN) return null;
  // Must be a rooted path — reject protocol-relative and backslash tricks up front.
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return null;
  if (raw.includes("\\") || raw.includes("://")) return null;
  // Reject any control char (incl. the newlines/tabs that smuggle javascript: past
  // naive checks) — done char-by-char to avoid a control-char regex literal.
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return null;
  }
  // Bound to the findings surface — the only place these handoffs originate.
  const path = raw.split(/[?#]/)[0];
  if (path !== "/findings" && !path.startsWith("/findings/")) return null;
  return raw;
}

/**
 * Canonical fallback back-link for a known handoff context, used when `return` is
 * absent or unsafe. An ops bucket reconstructs its own server-derived filters from
 * its id (`?bucket=<id>`); "findings_queue" falls back to the unfiltered browse
 * list. null for an unrecognized context (no back-link rendered).
 */
export function queueHandoffFallbackHref(from: string | null | undefined): string | null {
  if (from === FINDINGS_QUEUE_CONTEXT) return "/findings?queue=all";
  const b = opsBucket(from ?? undefined);
  if (!b) return null;
  return b.target.kind === "href" ? b.target.href : `/findings?bucket=${b.id}`;
}

/**
 * The Decision Workspace href for a finding, carrying the originating-queue handoff
 * so open-in-new-tab / copy-link preserve it exactly like an in-tab click.
 *
 * With no queueContext (e.g. an entity-detail finding list) the link is the bare
 * `/findings/:id` — byte-identical to the pre-handoff behavior. With a context, it
 * carries `from=<context>` plus, when a current queue URL is known, `return=<url>`
 * so the workspace can offer an exact "back to your queue" link (search, filters,
 * sort, page, bucket) that works from the URL alone.
 */
export function buildDecisionHref(
  findingId: string,
  queueContext: string | null | undefined,
  currentPath?: string | null,
  currentQuery?: string | null
): string {
  if (!queueContext) return `/findings/${findingId}`;
  const params = new URLSearchParams();
  params.set("from", queueContext);
  if (currentPath) {
    const returnUrl = currentQuery ? `${currentPath}?${currentQuery}` : currentPath;
    // Only carry a return we would actually honor on the read side.
    if (safeQueueReturnUrl(returnUrl)) params.set("return", returnUrl);
  }
  return `/findings/${findingId}?${params.toString()}`;
}
