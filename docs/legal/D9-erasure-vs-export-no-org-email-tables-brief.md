# D-9 Decision Brief — Email-keyed, no-org tables under Art. 17 erasure (and Art. 15 export)

**Status:** OPEN QUESTION FOR LEGAL / DOCUMENTED CONTROLLER DETERMINATION. No decision made here. No code, no migration.
**Date assembled:** 2026-06-16
**Audience:** privacy counsel (or controller making a documented Art. 17(1) / 6(1)(f) determination)
**Decision needed before:** the account-deletion reaper is built (currently Phase-0 decisions locked, NO reaper code exists yet).

> This is a brief, not a determination. It states the question and the verified facts so the call can be made in one pass.

---

## 1. The precise question

When an **account holder** (a `users` row) submits an **Art. 17 erasure request**, must the deletion reaper **also act on the four no-org, email-keyed tables** —

- `subscribers`
- `newsletter_deliveries`
- `email_suppressions`
- `email_provider_events`

— or is **"leave them in place, and provide a separate email-keyed unsubscribe/erasure path"** a *complete* discharge of the erasure obligation for that data subject?

The crux: these tables hold the subject's personal data (their email, and email-linked records), but they are **keyed by email address, not by the account UUID**, carry **no `organization_id`**, and are arguably processed under a **separate legal basis** from the account itself (newsletter consent / deliverability legitimate-interest) — the kind of relationship a user can sever independently of deleting their account.

---

## 2. Facts that bear on it (per table — all verified in code)

| Table | `organization_id`? | Keyed by | PII held | Has migration? |
|---|---|---|---|---|
| `subscribers` | nullable col exists; platform rows NULL | **`email` (UNIQUE)** | email | yes (`001_…sql` + `20260406_newsletter_schema.sql`) |
| `newsletter_deliveries` | nullable col exists; platform rows NULL | **`(issue_id, subscriber_email)`** | `subscriber_email`, `rendered_html` (embeds email in unsubscribe link), `last_error` | yes |
| `email_suppressions` | **NO column** | **`email` (UNIQUE)** | `email`, `reason` (e.g. "bounce"/"complaint") | yes (`20260406_…sql`) |
| `email_provider_events` | **NO column** | `provider_event_id`; **email column present** | `email`, **`payload` (raw JSONB webhook body — provider PII)** | **NO — schema drift** (written by code, never created by a migration) |

### Common shape (all four)
- **Not user-FK'd.** None reference `users.id`. The only link to a data subject is the **email string**.
- **No tenant key on two of them.** `email_suppressions` and `email_provider_events` have no `organization_id` at all — they are genuinely platform-global operational tables.

### Separate processing basis (arguable, per table)
- `subscribers` / `newsletter_deliveries` — **subscriber consent / contractual delivery** for the newsletter. A person may be a newsletter subscriber *without* an account, and may keep a subscription *after* deleting an account. These are not "account data."
- `email_suppressions` — **legitimate interest (deliverability + honoring prior opt-outs)** and arguably a **compliance record**: it is the durable proof that we must *not* mail a given address (bounce/complaint/unsubscribe).
- `email_provider_events` — **legitimate interest (operational deliverability / abuse forensics)**; raw provider telemetry.

### The cross-subject (recycled-email) data-loss risk — the central engineering hazard
Because the only join key is the email string, **an email address can, over time, belong to more than one natural person** (mailbox recycled, corporate address reassigned, typo'd signup). If the reaper deletes/scrubs these tables **by email match**, it acts on **whatever person currently owns that string in these tables — not necessarily the account holder who requested erasure.** That risks:
- erasing or unsuppressing data belonging to a *different* data subject (a fresh Art. 17 / Art. 5 integrity problem we would create), and
- doing so via a destructive query with **no tenant boundary to contain blast radius** (no `organization_id` to scope on).

---

## 3. Specific sub-questions

**(a) Is `email_suppressions` actually *required* to be retained? (the O-8 point)**
Deleting a suppression row **re-enables mail to an address that previously bounced or opted out.** That is arguably the opposite of what the data subject wants, and may itself breach ePrivacy / prior opt-out obligations. Is retaining `email_suppressions` (the *fact* that "do not email this address") a **legal obligation / overriding legitimate interest under Art. 17(3)(b)/(e)** that survives an erasure request — i.e. is suppression a record we are *required* to keep, not erase? If so, at most we'd scrub adjacent fields, never the suppression itself.

**(b) Does `email_provider_events` change the answer?**
Same no-org / email-key shape as the others, **but** it stores the **raw provider `payload` (JSONB)** — uncontrolled PII whose contents we don't fully normalize, under a weaker operational-LI basis, **and it has no CREATE TABLE migration at all** (schema drift; invisible to drift tests; unbounded retention). Does the rawness + weaker basis tip *this* table toward active erasure/minimization where the others stay leave-alone? Or does the same cross-subject email-key hazard keep it in the leave-alone bucket?

**(c) The live Art. 15 EXPORT side — does the export obligation differ from the erasure obligation?**
These two obligations can land differently and the current code already treats them differently:
- **Export today INCLUDES** `subscribers`, `intelligence_brief_subscribers`, `newsletter_deliveries` — matched on the subject's **current `users.email`** (read from DB, never from request).
- **Export today EXCLUDES** `email_suppressions` and `email_provider_events`.

Question: on an Art. 15 access request, **should `email_suppressions` and `email_provider_events` be added to the self-export by email** (they contain the subject's personal data), and is the answer to *that* allowed to diverge from the erasure answer? (It is legally coherent to **disclose** data under Art. 15 that we are **not obliged to erase** under Art. 17 — access ≠ erasure.) Note the same recycled-email caveat applies to export: matching on email could **disclose another person's records** to the requester — arguably a *worse* failure than over-retention.

---

## 4. Engineering constraint that holds regardless of the legal answer

**The reaper will NOT issue destructive writes to these no-org tables.** This is fixed, independent of D-9:

- The reaper's safety model is **explicit `WHERE organization_id = $jobOrgId` on every destructive statement**, inside a single org-scoped `withTenant` transaction. Two of the four tables **have no `organization_id`**, so they cannot be brought inside that guard at all.
- Acting on them would require **matching by email string with no tenant boundary** — exactly the cross-subject blast-radius hazard in §2.

Therefore: **whatever legal concludes must be achievable WITHOUT an org-scoped destructive query in the reaper.** If the conclusion is "the subject's data in these tables must be acted upon," the mechanism must be a **separate, email-keyed unsubscribe/erasure flow** (single-email, idempotent, with cross-subject safeguards) — *not* the reaper. The reaper at most **enqueues** such a request; it does not perform the no-org write itself.

---

## 5. The two recommended dispositions to choose between

### Disposition A — Leave-alone + separate email path + documented basis
The reaper does not touch any of the four tables. The subject's removal from newsletter/marketing is handled by the **existing email-keyed unsubscribe flow** (`unsubscribe.ts` already writes `subscribers.status='inactive'` + an `email_suppressions` row). Retention of `email_suppressions` / `email_provider_events` is justified by a **documented Art. 17(3) basis** (legal obligation / overriding legitimate interest in honoring opt-outs and deliverability).
- **Pro:** zero cross-subject risk; preserves the suppression record (no re-enabling mail); no destructive no-org query; matches how the system already works; minimal build.
- **Con:** the subject's `subscribers` / `newsletter_deliveries` rows persist (email still on file), so we must be able to defend "this is separate consent-based processing with its own withdrawal path, not account data" — and document it. Requires the unsubscribe path to be discoverable/communicated as the erasure route for that data.

### Disposition B — Active unsubscribe/scrub by email, with cross-subject safeguards
A dedicated **single-email erasure job** (not the reaper) scrubs/deletes the subject's rows in these tables by email, with safeguards: operate on **one exact-match email at a time**, require the email still resolves to the requesting subject, **retain `email_suppressions`** (or convert to a content-free hash) so opt-out is not lost, and minimize `email_provider_events.payload`.
- **Pro:** strongest "we erased everything about you" posture; addresses the raw-payload PII in `email_provider_events`.
- **Con:** introduces the **recycled-email cross-subject risk** (could erase/expose another person's data); must hand-build cross-subject safeguards and an idempotent email-keyed job; tension with the O-8 requirement to *keep* suppressions; more surface, more ways to get it wrong. The `email_provider_events` schema-drift (no migration) must be fixed first or the job operates on an untracked table.

---

## What legal needs to return (one pass)
1. **Erasure:** Disposition **A** or **B** for the newsletter tables (`subscribers`, `newsletter_deliveries`)?
2. **Suppression (3a):** Confirm `email_suppressions` is **retain** (Art. 17(3) basis) — yes/no.
3. **Provider events (3b):** Does `email_provider_events` follow the newsletter tables, or get minimized/erased on its own basis?
4. **Export (3c):** Add `email_suppressions` and/or `email_provider_events` to the Art. 15 self-export by email — yes/no — and is the recycled-email disclosure risk acceptable / how mitigated?

Once answered, the result is implemented as a **separate email-keyed flow**, never as a reaper write to a no-org table (§4).
