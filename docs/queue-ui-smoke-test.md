# Matcher queue UI — manual smoke test

This package ships with no automated frontend tests (per Package 4 scope).
Before promoting `develop` → `main`, walk this checklist against staging.
Each item is independent — the order is suggested, not required.

## Setup

- [ ] Logged in as a user whose org has the `standard` entitlement.
- [ ] Browser DevTools open, Network tab visible, Console clean before
      starting.

## 1. First-time-empty state

- [ ] As a brand-new org with **no rows** in `signal_match_suggestions`,
      visit `/queue`.
- [ ] Heading reads "Matcher queue".
- [ ] Empty state explains the matcher hasn't produced suggestions yet.
- [ ] **No** filter chips, sort dropdown, or pagination row are rendered.

## 2. Populated queue (default sort)

- [ ] Org with several pending suggestions across multiple `target_type`
      values.
- [ ] `/queue` shows pending count in the header (e.g. "12 pending").
- [ ] Filter chips render with per-target-type counts that **add up** to
      the pending total.
- [ ] Sort defaults to "Newest first". Top row's `created_at` is the most
      recent.
- [ ] Each row shows: target-type chip, target name (or id prefix),
      score (color-coded), signal title (or id prefix), source, severity,
      CVE, match reason — when those fields are present.

## 3. Accept flow + 5-second undo

- [ ] Click **Accept** on a row.
- [ ] Row leaves the visible list immediately.
- [ ] Toast appears bottom-right reading "Suggestion accepted" with an
      **Undo** button.
- [ ] Click **Undo within 5s**: row reappears, no `POST /accept` request
      in the Network tab.
- [ ] Click **Accept** again, wait 5+ seconds: `POST
      /api/signal-match-suggestions/{id}/accept` fires once, returns 200.
- [ ] Refresh the page: row is gone (now in `accepted` state on the
      server).
- [ ] Click Accept twice rapidly on the same row (within 5s). Confirm
      only one server action fires after the timer expires.

## 4. Dismiss flow + 5-second undo

- [ ] Click **Dismiss** on a row.
- [ ] Row leaves the list, "Suggestion dismissed" toast with **Undo**.
- [ ] **Undo within 5s**: row returns, no server call fired.
- [ ] **Wait 5s**: `POST /api/signal-match-suggestions/{id}/dismiss` fires,
      200.

## 5. Undo after 5s is a no-op

- [ ] Click Accept on a row.
- [ ] Wait > 5 seconds for the toast to fade.
- [ ] Row stays gone. No undo button is available. (This confirms
      `useTimedNotice` does not leak a stale undo handler past TTL.)

## 6. Filter chip click

- [ ] Click a target-type chip (e.g. Vendors).
- [ ] URL becomes `/queue?target_type=vendor`.
- [ ] List narrows to vendor rows only.
- [ ] Other chips remain clickable; clicking "All" returns to `/queue`.
- [ ] If the filtered list is empty for a non-empty org, the
      filtered-empty state appears with a "Clear filters" link — **not**
      the first-time-empty copy.

## 7. Sort change

- [ ] Click "Highest score first".
- [ ] URL becomes `/queue?sort=score-desc`.
- [ ] Top row has the highest `match_score`. Rows with `null` score
      appear at the bottom (NULLS LAST).
- [ ] Click "Newest first" to revert; URL drops the `sort` param.

## 8. Pagination

Only applicable when total pending > 25.

- [ ] Click **Next →**: URL becomes `/queue?offset=25`.
- [ ] Header reads "Showing 26–50 of N".
- [ ] Click **← Previous**: returns to `offset=0`.
- [ ] On the last page, **Next →** is disabled (greyed out).
- [ ] On the first page, **← Previous** is disabled.

## 9. Concurrent accept / dismiss

- [ ] Rapid-fire click Accept on three different rows within 2 seconds.
- [ ] All three rows disappear immediately.
- [ ] Within 5 seconds, click **Undo** on the toast (Undo applies to the
      most recent action — confirmed by the message text). Only that row
      returns; the other two commit.
- [ ] Network tab: exactly two `POST /accept` calls fire after their
      timers elapse, none for the row that was undone.

## 10. Route navigation commits pending intents

- [ ] Click Accept on a row.
- [ ] **Within 5 seconds**, click any other nav link (e.g. /vendors).
- [ ] Network tab: `POST /accept` fires immediately on navigation.
- [ ] Navigate back to `/queue`: row is gone (in accepted state).

This is the documented "intent to commit on unmount" behavior. See
`queue-ui-design-decisions.md` for rationale.

## 11. Tab close does NOT commit

- [ ] Click Accept on a row.
- [ ] **Within 5 seconds**, close the browser tab.
- [ ] Reopen the queue: row is still pending.

## 12. Embedded list on a vendor detail page

(Pending — embedded list is wired in a follow-up. When that lands, add
this section.)

## Pre-deploy gate

Treat this checklist as required before promoting `develop` → `main`:

- [ ] All sections above passed.
- [ ] No console errors during any flow.
- [ ] Network tab shows no duplicate `POST /accept` or `POST /dismiss` for
      a single click.
- [ ] Re-running the matcher in staging produces new pending rows that
      appear in the queue without a manual reload (after navigating away
      and back).
