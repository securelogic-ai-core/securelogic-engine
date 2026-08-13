# September 15 Launch Runbook — Vendor Assurance + Ask

Operator-facing. Everything here is **owed to a human**: no step in this document
has been executed, because every one of them requires credentials or an
environment this build had no access to.

Baseline: `develop` @ `58285e67`. Three stacked branches (session 2 continues
`feat/sept15-va-phase1-engagement-spine`), none pushed, none merged.
**Production is untouched.**

---

## 1. What ships behind which flag

Every new capability is dark. Nothing changes behaviour on deploy.

| Flag | Default | Controls | Rollback |
|---|---|---|---|
| `SECURELOGIC_VENDOR_ASSURANCE_ENABLED` | **already true in prod** | The internal engagement API | Flag off → routes 404 |
| `SECURELOGIC_VENDOR_PORTAL_ENABLED` | **off everywhere, incl. non-prod** | The entire external vendor surface | Flag off → 404 before any handler. **Does NOT revoke live sessions — see §6** |
| `SECURELOGIC_ASK_ENABLED` | **on** (kill switch for a live feature) | `POST /api/ask` | Flag off → 404. Removes a shipped capability; use only in anger |
| `SECURELOGIC_ASK_TOOLS_ENABLED` | **off** | Ask's retrieval path: tools vs the A0 snapshot | Flag off → snapshot path. No migration, no data change |
| `SECURELOGIC_ASK_PROVENANCE_ENABLED` | **off** | The claim-verification pass | Flag off → plain answer. Costs one extra model round trip per answer |

The portal flag is the one that matters. It is the only flag in the platform
guarding an **unauthenticated write path**, and it is deliberately off even
off-production — unlike `vendorAssuranceFeatureFlag`, which opens on non-prod for
developer convenience. An external write surface must never be open by accident
on a preview environment.

---

## 2. Migrations

Twelve, in dependency order. All additive. All validated against a fresh
database by the isolation harness (147 files / 1,126+ tests).

| Migration | What it does | Reversible? |
|---|---|---|
| `20260919_vendor_engagements` | The workflow spine | Drop table |
| `20260920_vendor_engagements_rls` | RLS on the spine | Drop policy |
| `20260921_vendor_tier_b_rls` | RLS across nine previously-unprotected vendor tables | Drop policies |
| `20260922_ask_conversations` | Threads, messages, tool-invocation ledger | Drop tables |
| `20260923_vendor_portal_access` | Invites + portal sessions | Drop tables |
| `20260924_vendor_engagement_scope` | Frozen scope + response revisions | Drop tables; **widens a CHECK on `requirement_responses`** |
| `20260925_vendor_portal_evidence_comments` | Comments table; **alters shared `evidence`** | See below |
| `20260926_requirement_scope_tags` | `scope_tags` + heuristic backfill on `requirements` | Drop columns |
| `20260927_engagement_intake_and_effectiveness` | Four intake dimensions, effectiveness columns; **alters shared `evidence`** | Drop columns |
| `20260928_vendor_engagement_findings` | `vendor_engagement` source_type, `requirement_id`/`severity_rationale` on **shared `findings`**, promotion uniqueness | Drop index/columns; **widens `findings.source_type` CHECK** |
| `20260929_vendor_engagement_monitoring` | Monitoring/reassessment marks on the spine; accepted-vendor-match index | Drop columns/index |
| `20260930_engagement_evidence_analysis` | `evidence_analysis` (advisory verdicts) + RLS; **widens `jobs.job_type` CHECK** with `vendor_evidence_analysis` | Drop table; re-narrow CHECK after confirming no surviving rows |

**Three migrations touch tables outside the vendor-assurance blast radius.**
`20260925` and `20260927` both alter `evidence`, which every remediation and
control-test surface reads; `20260928` alters `findings`, which every findings
surface reads. All are additive (nullable columns, widened CHECKs, new
constraints), but a rollback must **drop the constraints before the columns**
or it will fail.

`20260926` runs a data backfill over every row in `requirements`. It is
idempotent and never overwrites a row marked `curated`.

---

## 3. Pre-deploy checks — all operator-owed

- [ ] **B2.** `render.yaml` sets `SECURELOGIC_VENDOR_ASSURANCE_ENABLED: "true"` on
      the prod engine and declares **no `R2_*` variables**. If R2 really is
      unconfigured in prod, every evidence upload returns 503 `storage_unavailable`
      — correct behaviour, but it means the portal cannot accept attachments.
      Not provable from the repository.
- [ ] **B1.** Ratified Decision 3 made "prove there are no runtime writers" a
      precondition of freezing legacy `assessments`. **The proof failed** —
      `assess.ts:159` writes to it and `assessments.ts` reads it, all mounted and
      entitlement-gated. The freeze migration was therefore not written.
      **Recommendation: drop the freeze from the launch program.** Retiring a
      public API route is a separate decision with its own notice period.
- [ ] **B4.** Scope-tag curation is **0% curated**. Every tag is
      `source = 'heuristic'`, derived from requirement titles. The questionnaire
      will function; it has not been reviewed by anyone who knows the frameworks.
      Query the readiness number:
      ```sql
      SELECT scope_tags_source, count(*) FROM requirements GROUP BY 1;
      ```
- [ ] Confirm `SECURELOGIC_VENDOR_PORTAL_ENABLED` is **absent or false** on every
      environment before deploy.

---

## 4. Deploy order

Render injects environment at **deploy**, not at restart. A flag set after a
deploy is config-true and process-false until the next build. This bit the Wave 1
promotion on 2026-08-05.

1. Set flags **first**, to their launch values (all new ones off).
2. Deploy the engine. Migrations run on boot.
3. Verify `/health` and confirm the schema version advanced.
4. Deploy the app.
5. Only then flip a flag, one at a time, verifying between each.

Recommended enablement order, staging first:

```
SECURELOGIC_ASK_TOOLS_ENABLED        → validate → SECURELOGIC_ASK_PROVENANCE_ENABLED
SECURELOGIC_VENDOR_PORTAL_ENABLED    → LAST, and only after §5 passes
```

Ask's tool path first because its rollback is the cheapest in the system: a flag
flip restores the snapshot path with no migration and no data change.

---

## 5. Stop Gate B — what is still open

**NOT PASSED.** Five of seven criteria pass. The two that remain cannot be closed
by a test suite:

| # | Criterion | Status |
|---|---|---|
| B.3 | Independent security review of the portal surface | **Open — needs a human** |
| B.4 | A real external tester completes an engagement on staging | **Open — needs a human** |

The approved schedule rule applies: **if portal isolation has not passed by
2026-08-27, apply the approved portal cut rather than compressing security.**
Cutting the portal removes migrations `20260923`/`20260925` from the launch and
leaves the internal engagement workflow intact — a reviewer can still run an
assessment; the vendor sends answers by email.

Reviewer briefing material: `docs/validation/sept15-stop-gate-b-progress.md`
(design decisions and the four defects the adversarial work found).

---

## 6. Incident response

**Kill the external surface.** The flag makes `requirePortalSession` unreachable
but does **not** revoke sessions already issued:

```sql
UPDATE vendor_portal_sessions SET revoked_at = NOW() WHERE revoked_at IS NULL;
```

The partial index `idx_vendor_portal_sessions_live` exists for this.

**Revoke one vendor's access:**

```sql
UPDATE vendor_engagement_invites
   SET revoked_at = NOW(), revocation_reason = '<why>'
 WHERE engagement_id = '<id>';
UPDATE vendor_portal_sessions
   SET revoked_at = NOW()
 WHERE engagement_id = '<id>' AND revoked_at IS NULL;
```

**Suspected cross-tenant leak.** The approved rule halts the affected program.
Turn off the relevant flag first, then investigate — do not investigate first.

Portal actions are in `security_audit_log` under `vendor_portal.*`, each carrying
its `invite_id` and engagement. Ask's tool reads are in `ask_tool_invocations`,
including the **denied** ones, which is what answers "did Ask try to read
something it shouldn't have".

**Ask giving wrong answers.** Turn off `SECURELOGIC_ASK_PROVENANCE_ENABLED`
first if the complaint is latency; turn off `SECURELOGIC_ASK_TOOLS_ENABLED` if
the complaint is accuracy. Do not turn off `SECURELOGIC_ASK_ENABLED` — that
removes a capability customers already have.

---

## 7. What to watch after enablement

| Signal | Where | What a bad number means |
|---|---|---|
| `ask_provenance_complete.downgraded` | logs | Rising = the model is asserting things the data does not support |
| `authorized = false` rate | `ask_tool_invocations` | Rising = Ask is repeatedly attempting reads the caller cannot make |
| `portal_invite_rejected` | logs | Bursts = someone is guessing tokens; the counter is DB-backed and holds with Redis down |
| `storage_unavailable` | logs | R2 is not configured (see B2) |
| `inherent_understated = true` | `residual_basis` | Not a bug — intake answers understated the exposure. Worth a reviewer's attention |

---

## 8. Rollback

Each branch is a rollback point:

- `feat/sept15-va-phase0-truth-repair` — truth repair only
- `feat/sept15-ask-a0-truth-pass` — Ask's five live defects
- `feat/sept15-va-phase1-engagement-spine` — everything else

**Flags first, always.** Every capability here is reachable only through a flag,
so turning the flag off is a complete functional rollback with no schema change.
Reverting a migration should be a last resort and, for `20260925`/`20260927`,
requires dropping constraints before columns.

---

## 9. Explicitly deferred — P2 and P3

Recorded so the absence is a decision rather than an oversight. Full list with
reasoning: `docs/validation/sept15-execution-status.md` §6.

**P2:** Ask `mutate`/`governed` action classes with server-issued confirmation
tokens (Stop Gate ASK-B); "what changed" diff tools; the Intelligence Brief
consuming the platform tool registry; targeted-reassessment delta view;
`vendor_control_assessments` as a first-class object; CUEC coverage gaps promoted
to findings; concentration/nth-party exposure; threaded portal clarifications;
per-org methodology weight profiles.

**P3:** embedding pipeline + RAG; proactive/agentic monitoring; knowledge-graph
reasoning; custom questionnaire templates with conditional logic; automated
evidence validation; continuous attestation; shared vendor profiles across
tenants.

**Session 2 (2026-08-13) closed the previously-unfinished P0/P1 list:** the
seven portal screens (plus the same-origin proxy), the evidence-analysis
worker, findings promotion, evidence review, the review-chain transition
routes, monitoring sweeps + the intelligence reassessment hook, and the Ask A3
engine surface, plus two P1 defects found by building against the API (the
portal cookie path that a real browser would never send, and answer edits
409ing during clarification). **Still open:** Ask A3 conversational UI
(in flight), Ask A5 voice (P1 — the standing cut rule applies), and every
operator-owed item in §3–§5.
