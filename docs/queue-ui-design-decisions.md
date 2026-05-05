# Matcher queue UI — design decisions

This document captures decisions taken during Package 4 (matcher queue UI)
that are intentional and not bugs. Reviewers and future contributors should
read this before "fixing" any of the following behaviors.

## Local-only undo (no server-side undo state)

Accept and Dismiss in the queue UI use a 5-second optimistic-commit timer.
The pattern:

1. User clicks Accept (or Dismiss).
2. The row is hidden from the visible list immediately.
3. A toast appears with an Undo button.
4. After 5 seconds with no Undo, the corresponding server action runs.

There is no server-side "soft accept" or "soft dismiss" state. The
`signal_match_suggestions` table has only three states (pending, accepted,
dismissed) and undo is purely a local affordance for the small window
between the click and the server call.

**Closing the tab during the 5-second window does NOT count as a
dismissal.** No server call has fired yet. This is deliberate, not a bug —
the alternative (writing a "soft" state to the DB on every click) would
double the state machine and the network traffic for a UX nicety that only
matters in the 5-second window.

The companion intentional behavior, however, is that **route navigation
within the same SPA session DOES commit pending intents** — see
"Concurrent timer cleanup on unmount" below. So:

| User action during 5s window | Behavior |
| --- | --- |
| Clicks Undo | Row returns to idle. No server call. |
| Closes the tab / browser | No commit. Suggestion stays pending. |
| Navigates to another route in the SPA | Commits immediately. |
| Does nothing | Commits at 5s. |

If a future product decision wants tab-close to count as a commit, the
right primitive is a `navigator.sendBeacon` call in a `beforeunload` —
but that's a separate package. Don't add it without an explicit ask.

## Double-click Accept (or Dismiss) on the same row

If a user clicks Accept twice on the same row within the 5-second window,
`beginPending` cancels the prior timer and starts a fresh 5s window. The
user can keep re-clicking Accept indefinitely; the row won't commit until
5s elapses without further interaction. This is intentional — it
preserves the user's right to undo without making double-click a bug.

## Concurrent timer cleanup on unmount

`SuggestionList` tracks pending commit timers in a `Map<suggestionId,
TimeoutHandle>` at the component level — not in per-row state. Two reasons:

1. A user can rapidly accept/dismiss multiple rows; each row's timer
   must coexist independently. A `Map` keyed by `suggestionId` gives O(1)
   cancel-and-replace when undo fires, and O(N) drain on unmount.
2. The state machine is per-row, but the cleanup boundary is
   component-wide. Per-row state cannot drain peer timers.

On `useEffect` cleanup (component unmount, e.g. route navigation), the
hook **fires every pending timer immediately** instead of cancelling them.
The user's intent was already captured at click-time; silently dropping
those intents on a route change would lose user-visible work.

This is the asymmetry that makes "tab close = no commit" but
"route change = commit" both correct. Tab close removes the page entirely
and no React cleanup hook gets the chance to run reliably. Route change
runs cleanup hooks deterministically.

## Signal detail page intentionally not built in Package 4

A row click in the queue navigates to the **entity** detail page (vendor,
ai_system, control, obligation), not to a signal detail page. Rationale:

- The signal's identity (title, source, severity, CVE, matched-on snippet)
  is rendered inline in the row itself. A user accepting or dismissing a
  suggestion has the information they need without a second pageload.
- Building `/signals/[id]` now would commit to a shape — dedicated route?
  side panel? inline expansion? — before we have user feedback on whether
  it's needed at all.
- The platform's risk-engine surfaces (dashboard, briefs) link to entities
  by id; there is no other current consumer of a signal-detail route.

A future package will pick the shape based on observed user behavior.
**Do not** scaffold an empty `/signals/[id]` route to "save the URL space"
— it ships dead UI and constrains the eventual design.

## Lifetime-total inventory check via /counts (not a separate helper)

The first-time-empty state ("this org has never had a suggestion") needs a
"any state at all" count, distinct from the "pending count" the queue page
already needs. Two options were on the table:

- **(A)** Add a small helper in `app/src/lib/api.ts` that runs
  `SELECT 1 FROM signal_match_suggestions WHERE organization_id = $1
  LIMIT 1`.
- **(B)** Extend `GET /signal-match-suggestions/counts` to include a
  `lifetime_total` field.

Package 4 picked **(B)**. Reasons:

- The queue page already calls `/counts` for the per-target_type chips.
  Adding `lifetime_total` to the same response is one more `COUNT(*)`
  in the existing query — no extra round-trip.
- Option A would have created a one-purpose helper that other callers
  would inevitably try to reuse for other "exists?" checks, leading to
  a one-row-helper proliferation we already hit with vendor existence
  probes earlier.
- The cost is one additional unfiltered `COUNT(*)` per page render. The
  table is partial-unique-indexed by `(organization_id, signal_id,
  target_type, target_id)` and bounded by per-org matcher throughput.
  Not load-bearing.

If `lifetime_total` becomes load-bearing on a hot path later, switch to
`EXISTS (SELECT 1 …)` — the public field stays the same.

## What this package does not include

- A signal detail route (see above).
- A bulk-accept / bulk-dismiss endpoint or UI.
- Server-side enrichment of `signal_title`, `signal_severity`,
  `target_name` on the list endpoint. The queue page passes raw rows and
  the UI degrades to id prefixes when the enrichment fields are absent.
  Wire enrichment in a follow-up package.
- Frontend automated tests. See `queue-ui-smoke-test.md` for the manual
  pre-deploy checklist.
- Posture / brief surfacing of accepted suggestions. The accept handler
  writes a regular `signal_*_links` row, which existing posture and brief
  consumers already read; no extra wiring needed in this package.
