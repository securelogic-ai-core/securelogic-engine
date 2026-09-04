# WA-1 — Response completeness and evidence at the point of answering

**Result: PASS**

| | |
|---|---|
| Package | WA-1 (owner walkthrough remediation, rulings 3 and 6) |
| PR | [#1006](https://github.com/securelogic-ai-core/securelogic-engine/pull/1006) |
| Merge SHA | `c11e641c36f2b0e096673baec448e7f2ca2f3272` |
| `develop` after merge | `c11e641c` |
| Staging deployed SHA | `c11e641c` — engine-staging live 22:59:32Z, app-staging live 23:01:54Z |
| Migrations | **none** |
| Production | **untouched.** `SECURELOGIC_VENDOR_ASSURANCE_ENABLED=false` on the production engine, unchanged |
| Date | 2026-09-04 |

---

## 1. What this package closes

Measured on the owner's own walkthrough engagement before anything shipped
(`f27c87ae-1617-4f5b-b91a-dd7ce1f0e508`, submitted 2026-09-04 19:41Z), read back
from `GET /api/vendor-engagements/:id/responses`:

| | |
|---|---|
| Questions scoped / answered | 37 / 37, all mandatory |
| Answers | 28 `pass`, 5 `partial`, 3 `fail`, 1 `not_applicable` |
| **Answers carrying any explanation** | **0 of 37** |
| **Evidence artifacts attached** | **0** |
| `assurance-coverage` | `covered: []`, `gaps: []`, `governed_evidence: []` |

Every control therefore sat at `asserted` — the weakest rung of the
control-effectiveness ladder (0.5 credit) — and the eight negative answers were
headed for promotion to Findings with no vendor statement behind any of them.

Two causes:

1. The submit guard implemented only `all_mandatory_answered`. An unexplained
   `partial` was indistinguishable from a considered one.
2. Evidence upload existed only at `/portal/evidence` behind a requirement
   dropdown. `/portal/questionnaire` contained the string "evidence" **zero
   times**, so a responder answering questions was never offered the artifact
   the question was asking for.

## 2. What was built

### Ruling 3 — the explanation rule

Enforced at **submit**, never at save, so a vendor can choose an answer and then
type why.

```
partial / fail / not_applicable  -> explanation required
pass                             -> required only where the question's
                                    evidence_policy asks for more
```

**No migration.** The rule is answer-driven and therefore constant per question;
the one genuinely per-question case is already stored in
`question_versions.evidence_policy` (migration `20261059`), which had been
written since VA-Q1 P1 and read by nothing. Adding a field to the question
content contract would have rehashed and republished the entire bridged question
library to store a constant.

The rule lives in one pure module, `src/api/lib/vendorPortal/responseCompleteness.ts`,
called by the engine's submit gate and by the read surface the vendor's UI
renders from, so the prompt a vendor sees and the refusal they would hit cannot
disagree.

**API compatibility:** the 422 body is additive — `error` and
`unanswered_required` keep their shipped meaning; `explanations_missing`,
`evidence_missing`, `items` and `items_truncated` are new. No stored row becomes
invalid, and no CHECK constraint was added that could fail to build against the
existing estate.

**Deliberately wider than the shipped guard in one place:** a missing explanation
blocks on any *answered* item, mandatory or not. An optional control answered
`fail` promotes to a Finding with the same severity machinery, so tying the
requirement to `mandatory` would leave the least-supervised answers the least
explained.

### Ruling 6 — write authorization ends at conclusion, engagement-scoped

`isPortalRespondable` already refused writes from `submitted` onward, so a
completed questionnaire was never editable. The gap was a live credential with a
seven-day read tail.

Terminated at **`analysis_complete`**, not at `submitted`: `submitted` is
deliberately reopenable via `clarification_requested`, and revoking there would
break the one workflow that state exists for. `analysis_complete` is where
`isPortalCommentable` stops and no transition returns.

Engagement-scoped by construction — a session belongs to one invite and one
engagement — so a contact working on two assessments keeps the other. The invite
is revoked alongside the sessions, because revoking sessions alone would be
theatre while the emailed link sits in an inbox able to mint a new one. Guarded
on the transition's own `rowCount`.

### Evidence at the point of answering

Per-question attach on `/portal/questionnaire`, posting to the **same canonical
endpoint** the document library uses (`POST /vendor-portal/evidence` → the
`evidence` table with `engagement_id` + `requirement_id`). No second attachment
model, no second storage path, no second validator. `/portal/evidence` remains
the central library.

## 3. Validation

### Automated suites

| Lane | Result |
|---|---|
| Engine unit (`vitest run src/api/__tests__`) | **429 files / 7928 passed**, 3 skipped |
| — of which new | `responseCompleteness.test.ts`, **49 cases**, exhaustive over the 4×4 answer × evidence-policy grid |
| App unit (`cd app && vitest run`) | **168 files / 2156 passed** |
| — of which new | 8 portal cases across questionnaire + review render suites |
| Isolation, real Postgres — new | `vendorPortalResponseCompleteness.test.ts`, **15 passed** |
| Isolation regression | **104 passed** — `vendorPortalSubmitAtomicity`, `vendorPortalAdversarial`, `vendorPortalUploadAdversarial`, `vendorEngagementInviteLifecycle` |
| Isolation regression | **96 passed** — `assessmentComposition`, `vendorEngagementResponsesRead`, `vendorAssuranceEndToEnd`, `vendorEngagementsRls`, `vendorRelationshipEngagements`, `vendorEngagementIssueAtomicity` |
| `tsc --noEmit` (engine + app) | clean |
| `eslint` (engine) | clean |

### CI on the merged head (`34a33a5f`, all eight required checks)

`audit` · `build` · `cross-org-isolation` · `lint` · `tenant-coverage` ·
`test` · `typecheck` · `url-drift` — **all success**.

### Deployed-staging browser proof

`scripts/validation/wa1-response-completeness-staging-journey.mjs`, run against
**deployed staging at `c11e641c`**.

| Run | Result |
|---|---|
| Chromium | **26 / 26 PASS, 0 FAIL** |
| WebKit (run 1) | **26 / 26 PASS, 0 FAIL** |
| WebKit (run 2) | **26 / 26 PASS, 0 FAIL** |

Assertions, in order: attach control present on every question (23/23) · nothing
demanded before an answer exists · "Partially in place" prompts on the click ·
the prompt is answer-specific · the field is labelled required · Submit disabled
while unexplained · review names the count · review names the reason per item ·
an unexplained item is not mislabelled "unanswered" · **the engine refuses with
422 `explanations_missing=1`** · the refusal names the exact item and reason ·
the prompt clears once explained · evidence attaches at the question and lists
there · **the artifact lands on the canonical evidence spine bound to its
requirement** · Submit enables · submission succeeds · the explanation is on the
customer-side response record · the vendor can still read between submit and
conclusion · concluding revokes 1 invite and 1 session · the live browser
session 401s immediately · no client-side exceptions.

### Negative control

The journey was dry-run against **pre-WA-1 staging** before the merge. It passed
setup and portal exchange and failed every WA-1 assertion — confirming the
assertions test the change and not the harness. That dry run also surfaced two
harness defects, fixed before merge:

- `waitForURL(/\/portal(\/|$)/)` is satisfied by `/portal/accept/<token>` itself,
  so it returned before the exchange POST ran and the next navigation raced it.
- Accessible-name matching is substring, so `{name: "In place"}` resolved to
  three buttons.

A third was found and fixed *after* the first WebKit run: landing on `/portal`
starts the shell's engagement fetch, and navigating immediately cancels it;
WebKit reports a cancelled fetch as a `pageerror` while Chromium reports
nothing. That made the no-client-exceptions assertion **flaky** — it failed one
WebKit run and passed the next on identical code. Fixed by settling the load
rather than filtering the symptom, then confirmed stable over two consecutive
WebKit runs.

### Tenant and engagement isolation

Asserted against real rows in `vendorPortalResponseCompleteness.test.ts`:

- concluding an engagement in org A leaves the **same contact's** other active
  engagement fully live **and writable**;
- concluding an engagement in org A leaves **org B's** invite and session
  untouched and its portal reads at 200;
- a revoked invite cannot mint a fresh session (401);
- the revocation counts are recorded on the
  `vendor_engagement.analysis_completed` audit event.

## 4. Remaining known gaps

Carried forward, not regressions:

- **WA-2** — the analyst basis panel, the contact edit path, the hidden-inactive
  contact collision, the `overrideInherent` refusal copy, and the intake `reason`
  field remain unbuilt.
- **`evidence_links` reuse across requirements** is not yet written from the
  portal. One artifact still binds to one requirement per upload. The governed
  writer and routes exist behind `SECURELOGIC_EVIDENCE_LIFECYCLE_V2` (true on
  engine-staging, undeclared and therefore off in production); wiring the portal
  to it is a follow-on, not part of this package's assertions.
- **Multi-participant portal identity (VA-P1)** does not exist; a portal session
  is per-invite, so attribution on answers is per-invite, not per-person.
- The `not_assessed` status admitted by `requirement_responses` is read as
  "unanswered" by the gate. The portal never writes it; older internal
  assessment paths can.

## 5. Fixture hygiene

Six `WA1 journey …` vendors created on the staging validation tenant by the
journey runs were archived after validation. The engagements they carry are
retained (archiving the vendor, never deleting the record). No production data
was touched at any point.
