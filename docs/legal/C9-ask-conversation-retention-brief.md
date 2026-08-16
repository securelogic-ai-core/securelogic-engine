# C-9 — Ask conversation retention: decision brief

**Status: AWAITING OPERATOR RULING.** Nothing here is implemented. No schema,
route, flag or policy text was changed to produce this brief.

**Why it is blocking.** C-9 is a promotion condition in
`docs/validation/develop-to-main-promotion-audit.md` §10 ("Ask conversation-text
retention accepted — new retained customer data, activates unconditionally").
Stage 1 shipped on 2026-08-16 06:56Z, so **production has been accumulating this
data since that moment**, under no retention rule and with no deletion path.

---

## 1. What is actually true today (verified in code, not assumed)

**Persistence is not flag-gated.** `src/api/routes/ask.ts` calls
`createConversation` / `recordUserMessage` / `recordAssistantMessage` on the
normal answer path, best-effort. Every Ask turn in production writes the user's
question text and the assistant's rendered answer to `ask_conversations` /
`ask_messages`. No flag turns this off.

**There is no deletion path of any kind.** Zero `router.delete` handlers in
`ask.ts` / `askActions.ts`; zero `DELETE FROM ask_*` statements anywhere in
`src/`, `services/` or `app/`. `AskClient.tsx` says so in a comment: *"no thread
is ever deleted."* **Effective retention today is indefinite.**

**Account deletion does not remove Ask threads.** The Art.17 reaper tombstones
the `users` row rather than deleting it (decision-lock D-1), so
`ask_conversations.user_id … ON DELETE CASCADE` never fires, and
`ask_conversations` is not in `CATEGORY_B_DELETE_TABLES`. A self-deleted user's
questions therefore survive in the org, attributed to a tombstoned user. The
reaper is in any case inert everywhere: `SECURELOGIC_ACCOUNT_DELETION_REAPER_
ENABLED` appears **zero times** in `render.yaml`.

> Tension to resolve as part of this ruling: `dataClassification.ts` describes
> `ask_conversations` as *"included in GDPR export and erasure."* True for
> org-level erasure; **not** true of the self-deletion path. The line reads as a
> promise the reaper does not keep.

**Four tables, three different retention needs:**

| Table | Category | What it holds | Today |
|---|---|---|---|
| `ask_conversations` / `ask_messages` | C, PII **high** | Question + answer free text, claim blocks | Indefinite |
| `ask_tool_invocations` | E, append-only | Audit ledger **and** provenance substrate; SHAPE only, never payloads; records denials | Indefinite |
| `ask_provenance_contexts` | C, PII high | **Transient** full tool payloads for a deferred job; nulled + `purged_at` stamped at every terminal state | Self-purging — no decision needed |
| `ask_proposed_actions` | — | Frozen agentic proposals + execution digest | Dark until Stage 2 |

**Voice adds no separate artifact.** `transcribe.ts` uses
`multer.memoryStorage()` — audio is never written to disk or R2. A voice turn is
an `ask_messages` row with `mode='voice'`. Retention of voice **is** retention of
text. (The AI Policy §6 already discloses OpenAI Whisper for this.)

**No admin can read another user's threads.** Reads are user-scoped in the store;
not-found and not-yours are deliberately indistinguishable. Any admin deletion
capability is therefore a **new** capability — though delete can be granted
without granting read.

**No legal-hold concept exists in live code.** `legalHold` appears only in
`src/_frozen_prod/compliance/RetentionPolicy.ts`, which is frozen legacy.

### The one schema fact that constrains every option involving deletion

`ask_tool_invocations.message_id` is `NOT NULL REFERENCES ask_messages(id)
**ON DELETE CASCADE**`. So deleting conversation content **destroys the audit
ledger with it** — the opposite of the stated design intent, which is that the
ledger "must survive an erasure that removes the conversation it describes."

**Any option below that permits deletion requires one migration**: make
`message_id` nullable and `ON DELETE SET NULL` (or write a tombstone key), so
the ledger outlives the content it describes. This is not optional and should be
budgeted with whichever option is chosen.

---

## 2. What we have already published, and are therefore bound by

| Source | Commitment |
|---|---|
| Privacy Policy §10.2 | Customer Content retained **for the duration of the subscription**; 30-day retrieval window post-termination; thereafter deleted/archived/anonymized |
| Privacy Policy §10.4 | Security and audit logs retained **twelve (12) months**, or longer where required |
| Privacy Policy §13 | Right to deletion, **subject to legitimate retention exceptions** |
| AI Policy §6 / §7 | Anthropic (answers) and OpenAI Whisper (voice) already disclosed as AI Providers |
| AI Policy §9.2 | Customer Content not submitted for foundation-model training |

Two consequences. First, **today's indefinite retention is defensible under
§10.2** if Ask transcripts are treated as Customer Content — this is an unruled
default, not a live breach. Second, §10.4's twelve months is a published number
that fits `ask_tool_invocations` exactly, and holding that ledger indefinitely
would exceed our own stated period.

**Backups are outside any deletion promise.** `docs/DR_PLAN.md` still carries
`[OPERATOR-VERIFY]` on backup schedule and retention. No option below can promise
erasure from backups; §10.2's existing archival language already covers this, and
the policy text must not go further than that.

---

## 3. The options

### Option A — Ratify the status quo: transcripts are Customer Content, no special rule

| Dimension | Position |
|---|---|
| Default period | Indefinite, for the life of the subscription (Privacy §10.2); 30-day post-termination retrieval |
| Tenant configurability | None |
| User deletion | None |
| Admin deletion | None |
| Audit implications | Ledger also indefinite — **exceeds our published 12-month figure**; fix by shortening the ledger or amending §10.4 |
| Legal hold | Not required — nothing is ever deleted |
| Transcript / provenance | Unchanged; `ask_provenance_contexts` already self-purges |
| Deleted conversations | N/A |

**Build cost: zero.** Ruling and one policy paragraph only.

**Why it is weak.** A GRC platform that cannot delete its own assistant
transcripts will be marked down in every security questionnaire it meets, and
`ask_messages` is the highest-PII-risk free-text column in the product with no
expiry and no owner control. It also leaves the reaper tension above unresolved:
a user exercising Art.17 keeps their questions in the org forever.

---

### Option B — Bounded default, owner deletion, tenant override (phased)

| Dimension | Position |
|---|---|
| Default period | **365 days** rolling on `last_message_at`, then hard delete |
| Tenant configurability | **30–365 days**, org-level, admin-set. Capped at 365 deliberately so content can never outlive its evidence ledger |
| User deletion | Thread owner deletes their own thread, immediate hard delete |
| Admin deletion | Org admin may delete any thread in the org **by id or by user, without read access** — preserves the user-scoped read boundary |
| Audit implications | `ask_tool_invocations` fixed at **12 months**, matching published §10.4, and **not** tenant-configurable — a customer-shortenable audit log is not an audit log. Requires the `message_id` migration so the ledger survives content deletion |
| Legal hold | **Not built.** Documented gap with a named trigger (first contract or matter requiring it); interim control is disabling the sweeper flag, which is a manual, org-wide freeze |
| Transcript / provenance | Provenance contexts unchanged. Once content is deleted, its claims go with it; the ledger retains the SHAPE record for the remainder of its 12 months |
| Deleted conversations | Hard delete of conversation + messages + provenance contexts. No soft-delete, no tombstone, no recovery. Live systems only — backups age out on their own schedule |

**Phasing for a September launch** — the full option is more than the date needs:

- **For launch:** the ruling, the policy paragraph, the `message_id` migration,
  owner deletion, and a fixed 365-day sweeper behind a flag.
- **First post-launch package:** tenant configurability and admin blind-delete.
- **On trigger:** legal hold.

---

### Option C — Privacy-forward: short default, retention is an opt-in

| Dimension | Position |
|---|---|
| Default period | **30 days**, then hard delete |
| Tenant configurability | Org may extend to 365 days, or opt out of transcript storage entirely (Ask still works; it just keeps no history) |
| User deletion | As B |
| Admin deletion | As B |
| Audit implications | Ledger fixed at 12 months as in B — and it becomes the **only** long-term record of what Ask did, which is arguably the correct split: the system's record survives, the user's content does not |
| Legal hold | **Required at launch, not deferrable.** A 30-day sweeper destroying data during a live matter is worse than never having built the sweeper |
| Transcript / provenance | As B, but most turns lose their claims within a month |
| Deleted conversations | As B |

**The strongest story for regulated buyers** — "we do not hoard your prompts" —
and the cheapest data to defend, because most of it no longer exists.

**Why it is the riskiest to choose now.** It costs the most before launch
(sweeper + config + opt-out + legal hold), it degrades the A3 multi-turn
experience the LC program just built and validated, and — decisively —
**a retention floor is reversible; a deletion is not.** Starting at 365 and
tightening later is always available. Starting at 30 destroys transcripts we
cannot recover if the ruling turns out to be wrong.

---

## 4. Recommendation for the September launch: **Option B, phased**

1. **It is the only option that changes the current posture without betting the
   launch date on it.** A is a decision to do nothing about the weakest data
   position in the product; C front-loads a sweeper, an opt-out and legal hold
   into the weeks before launch.
2. **It resolves the reaper tension honestly.** Owner deletion plus a bounded
   default gives a real answer to "delete my Ask history" — which today has no
   answer at all, in a product sold on governance.
3. **It keeps content and evidence coherent.** Capping tenant retention at the
   ledger's 12 months means an answer never survives the record of how it was
   built. Uncapped, citations decay silently and the UI starts showing answers
   whose provenance rows are gone.
4. **It stays inside what we have already published.** 365 days sits within
   §10.2; the ledger's 12 months is §10.4 verbatim. No policy amendment is
   needed — only an Ask-specific paragraph making the period explicit.
5. **It is the reversible direction.** We can tighten to C's numbers later on
   evidence from real customers. We cannot un-delete.

**What B costs, stated plainly:** one migration on a table that is already in
production, a sweeper worker, a flag, an owner-delete route with its own
isolation tests, and a policy paragraph. It does **not** deliver legal hold, and
any enterprise contract that demands hold before we build it becomes a
commitment we cannot yet honour — that is the one exposure I would not paper over.

---

## 5. What the ruling needs to state

1. Which option (A / B / C), and for B, whether the phasing above is accepted.
2. The default period, and the tenant-configurable range if any.
3. Whether the `ask_tool_invocations` ledger is fixed at 12 months.
4. Whether admin blind-delete is in scope, or owner-only.
5. Whether legal hold is deferred, and if so, the trigger that un-defers it.
6. Whether `dataClassification.ts`'s "included in … erasure" line is corrected,
   or the reaper is extended to delete the user's threads on self-deletion.

Items 1–5 are product/legal calls. Item 6 is a correctness defect either way and
should be fixed regardless of which option is chosen.
