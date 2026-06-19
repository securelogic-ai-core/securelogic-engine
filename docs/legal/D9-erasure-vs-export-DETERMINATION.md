# D-9 Determination — Email-keyed, no-org tables under Art. 17 erasure & Art. 15 export

**Status:** SETTLED — recorded controller determination.
**Determined by:** Controller (operator), **2026-06-18**, having read the decision brief.
**Companion brief:** `docs/legal/D9-erasure-vs-export-no-org-email-tables-brief.md` (states the question + verified facts; assembled 2026-06-16), committed alongside this determination. (It had previously been held only in a local `git stash` and was recovered to its real path for this commit.)
**Scope of this pass:** RECORDING ONLY. No reaper code, no export code, no migration was written. Both implementations are future gated sessions.

This file is the recorded answer to the four return-items the brief posed in its "What legal needs to return" section.

---

## Half 1 — ERASURE (the D-9 proper question) — SETTLED

**Determination.** On an Art. 17 erasure request from an account holder (`users` row), the deletion reaper **LEAVES the four no-org, email-keyed tables untouched** — `subscribers`, `newsletter_deliveries`, `email_suppressions`, `email_provider_events`. **The reaper writes to NO no-org table.** This is **Disposition A** (leave-alone + separate email path + documented basis) across all four tables, and it confirms `email_suppressions` = **retain** (brief sub-question 3a) and that `email_provider_events` follows the newsletter tables on the erasure side (brief sub-question 3b).

**Basis.**
- These rows are processed under a **separate lawful basis** from the account — subscriber consent (newsletter) / deliverability legitimate-interest (operational) — not "account data."
- **`email_suppressions` retention is itself required**: deleting a suppression row re-enables contact to an address that previously opted out / bounced. Erasing it would breach the prior opt-out, not honor it. It is a record we are required to keep, not erase.
- The data subject **retains a standalone unsubscribe/erasure path** against these email-keyed records (independent of account deletion).
- The **recycled-email cross-subject hazard** makes email-keyed deletion unsafe: the only join key is the email string, which can belong to a different natural person over time; a destructive by-email write has no `organization_id` to bound blast radius.

This constitutes **complete Art. 17 erasure for the account.**

**Engineering invariant (holds regardless of any later decision):** the reaper **never writes to no-org tables.** Any future "act on the email-keyed records" outcome is a separate, single-email, idempotent flow — never a reaper write.

**Engineering precondition to confirm at reaper-build time:** the standalone unsubscribe/erasure path that this determination relies on must actually exist and be discoverable as the erasure route for these records. (Brief notes `unsubscribe.ts` already writes `subscribers.status='inactive'` + an `email_suppressions` row — confirm this is current and reachable before/with the reaper build.)

---

## Half 2 — EXPORT (Art. 15, the parked a/b/c question) — DECISION MADE, IMPLEMENTATION PENDING

**Determination.** Close the access gap via **option (a)**: **INCLUDE `email_provider_events` in the Art. 15 self-export**, matched by the subject's email, **STRUCTURED FIELDS ONLY** (`provider`, `event_type`, `created_at`), with the raw **`payload` jsonb EXCLUDED** (cross-subject leakage / unreviewed-blob risk per the brief).

This is a **decision to close, not a completed close.** It requires a code increment and is **NOT marked done.**

**Companion requirement (must land in lockstep).** `email_provider_events` has **no `CREATE TABLE` migration** (schema drift — invisible to the classification drift test). Adding it to `TABLE_CLASSIFICATION` therefore requires a **backfill DDL migration** in the same increment, or the drift test still won't protect the entry.

**Scope note (faithful to what was determined):** this determination adds **only `email_provider_events`** to the export. `email_suppressions` export-inclusion (the other half of brief sub-question 3c) was **not** added by this determination and remains excluded (status quo); it is not re-opened here.

---

## Mapping to the brief's four return-items

1. **Erasure — Disposition A or B for newsletter tables?** → **A** (leave-alone). Reaper writes to no no-org table.
2. **Suppression (3a) — retain `email_suppressions`?** → **Yes, retain.**
3. **Provider events (3b) — follow newsletter tables or minimize on own basis?** → **Follows the newsletter tables on the erasure side** (reaper leaves it alone; Category-E).
4. **Export (3c) — add to Art. 15 self-export by email?** → **Add `email_provider_events`** (structured fields only, `payload` excluded). `email_suppressions` not added. Implementation pending, with the schema-drift DDL backfill as a lockstep companion.

---

## What this unblocks (future gated sessions — NOT this pass)

- **Deletion reaper** — D-9 was the sole remaining gate; it is now cleared. The 4-component increment (request endpoint, cancel endpoint, enqueuer cron, reaper handler) is fully unblocked, to be built as its own gated session. Confirm the standalone-unsubscribe precondition above at build time.
- **Export-gap closure** — option (a) include-`email_provider_events` (structured fields, payload excluded) **plus** the `email_provider_events` CREATE-TABLE backfill DDL + `TABLE_CLASSIFICATION` entry, as one gated increment. Resolution decided; build pending.
