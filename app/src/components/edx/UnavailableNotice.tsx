/**
 * UnavailableNotice — EDX-1 (load discrimination) disclosure.
 *
 * The single rendering of "this failed to load". Generalized from
 * FindingsUnavailable (app/src/app/findings/page.tsx), which is the reference
 * implementation of the shape: name the subject, deny the false reading the
 * customer would otherwise reach, offer a way forward.
 *
 * It exists because nine surfaces answered this question independently and
 * five of them answered it with something untrue — most damagingly six list
 * pages that told a paying customer an engine outage was a limit of their
 * PLAN. `loadState` makes that attribution unrepresentable upstream; this
 * component makes the honest alternative a single import.
 *
 * Semantic rules:
 * - The subject is always named. "Something went wrong" is not a permitted
 *   output of this component.
 * - `denial` is REQUIRED. The difference between the good implementations and
 *   the bare ones is not the headline, it is the sentence that refuses the
 *   wrong conclusion ("not a limit of your plan", "not an empty list"). An
 *   optional prop would be dropped at exactly the call sites that need it.
 * - Cause is never attributed. No plan, no permission, no blame — the app
 *   layer cannot tell a 500 from a 403 (every lib/api reader collapses both
 *   to null), so it must claim neither.
 * - A retry is a control or it is absent. Prose telling the customer to
 *   refresh is not a recovery path, and this component will not render one.
 *
 * Server-safe: no hooks, no client directives, no data access.
 */

import Link from "next/link";

export function UnavailableNotice({
  subject,
  denial,
  reassurance,
  retryHref,
}: {
  /** What failed, in the customer's vocabulary: "Vendors", "Your policies". */
  subject: string;
  /**
   * The false reading being refused, phrased to follow "This is a loading
   * problem — ": e.g. "not a limit of your plan, and not an empty register".
   */
  denial: string;
  /** Optional restatement that their data is intact: "Your vendors are unchanged." */
  reassurance?: string;
  /**
   * Where "Try again" points — normally this page's own URL with the
   * customer's current filters preserved, so a retry does not silently
   * discard their context. Omit when the surface has no stable self-href.
   */
  retryHref?: string;
}) {
  return (
    <div
      role="alert"
      className="rounded-xl border p-8 text-center"
      style={{ background: "var(--color-brand-surface, #111827)", borderColor: "#1e293b" }}
    >
      <p className="text-sm font-semibold mb-1" style={{ color: "#f1f5f9" }}>
        {subject} couldn&rsquo;t be loaded right now.
      </p>
      <p className="text-sm" style={{ color: "#94a3b8" }}>
        This is a loading problem &mdash; {denial}.
        {reassurance ? ` ${reassurance}` : ""}
      </p>
      {retryHref && (
        <Link
          href={retryHref}
          className="inline-block mt-4 text-sm font-medium rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          style={{ color: "#00c4b4", outlineColor: "#00c4b4" }}
        >
          Try again
        </Link>
      )}
    </div>
  );
}
