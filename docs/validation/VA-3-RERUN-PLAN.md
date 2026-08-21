# VA-3 — Staging re-run plan (post extraction fix)

**Written:** 2026-08-21. **NOT EXECUTED.** The fix is not on staging (§0.1), so
this document plans the re-run and does not report one.

**Scope.** The re-run is driven through the **product UI** on staging. API and
database queries appear **only** as corroboration of a result a user could
already see, never as the way a step is performed. Where a gate can only be
satisfied by an API call or a SQL query, that gate is **not** a PASS — it is
recorded as DEGRADED or FAIL with the reason.

**Predecessor:** `docs/validation/VA-3-STAGING-EXERCISE.md` — the first run,
which reached upload and then failed extraction.

---

## 0. Read this before scheduling

### 0.1 The fix is not deployed, and cannot be without a decision

| Fact | Value |
|---|---|
| Fix commit | `76ed3f3f` (PR #855, 8/8 green) |
| `origin/develop` | `65cd3330` — **frozen promotion candidate** |
| Is the fix an ancestor of `develop`? | **No** |
| `hasNothingToSpan` present on `develop` | **0 occurrences** |
| Staging app deployed | `65cd3330` |

All seven staging services are pinned to `develop`. **The fix therefore cannot
reach staging without a merge into the frozen branch.** That is a genuine
conflict between three commitments already made, and it is the operator's to
resolve — not something this plan can route around:

| Option | Cost |
|---|---|
| **A. Merge #855 into `develop`** | Breaks the freeze. Re-mints the promotion candidate and re-opens R-1 blocker K-1 (green CI on the exact candidate). Cheap to repair — the migration set is unchanged, so the rollback rehearsal and migration inventory still hold; only the SHA and its CI run change. **Also redeploys staging, which is what #826 is measuring.** |
| **B. Repoint the staging engine + vendor-extraction worker to `fix/soc2-clean-report-extraction`** | Avoids touching `develop`, but changes staging state directly. **This is precisely why PR #827 is held**, and the same reasoning applies here. |
| **C. Wait for #826 (window 2026-08-25T07:00Z), promote, then merge #855 and re-run** | No conflict. Costs the delay. |

> **Recommendation: C**, unless Vendor Assurance must be demonstrable before the
> promotion. Both A and B disturb the staging state that the Tier 2 gate is
> measuring, and #826 is a hard `develop`→`main` gate. **Earliest clean
> execution window: after #826 clears and the promotion completes.**

**Do not start this re-run until §1 Gate 1 passes.**

### 0.2 Three gates are predicted to fail on today's code — before the run

These were established by reading the shipped code, not by guessing. They are
stated up front so the re-run is not scheduled expecting a PASS it cannot reach,
and so the failures are not discovered as surprises mid-exercise.

| Gate | Prediction | Why |
|---|---|---|
| **12 — engagement leg** | **N/A — pending ADR-0010** | `vendor_assurance_documents` has **no `engagement_id` column**, and `20260919_vendor_engagements.sql` contains no reference to assurance documents. The two spines are **unlinked in the data model, in both directions**, and they never reference each other in code either. This is **not a defect of the exercise but an unanswered architecture question** — see `docs/architecture/decisions/ADR-0010-vendor-evidence-two-spines.md`. Record it as N/A, not FAIL: the gate asks for an edge the product has never decided should exist. |
| **12 — Finding back-links** | **FAIL (UI)** | `app/src/app/findings/[id]/page.tsx` renders only a `source_type` label ("Vendor Assessment"). It contains **no** reference to the vendor, document, CUEC or reviewer. Provenance is **one-directional**: `CuecDeterminationPanel` links CUEC → Finding, but nothing links Finding → CUEC. A user who arrives at the Finding cannot get back. |
| **16 — determination audit** | **DEGRADED** | Findings have a history UI (`HistorySection`, `GET /api/findings/:id/history`). The Vendor Assurance side has **no audit surface at all** — no `resourcePath=` anywhere under `app/src/app/vendor-assurance` or `app/src/components/vendorAssurance`. The determination audit event exists (`vendor_assurance.cuec.promoted_to_finding`) but is reachable only by API or SQL. |

**Consequence for the final gate.** Under the standing rule — *do not call
Vendor Assurance DONE if the product UI path still requires manual API calls,
internal IDs, direct database manipulation or Engineering intervention* — **the
extraction fix alone cannot take VA-3 to PASS.** The best achievable outcome on
current code is **DEGRADED**, with gates 1–11 and 13–15 passing and gate 12
failing in the UI.

Closing gate 12 needs a small, separate UI package — a provenance block on the
Finding detail page for `source_type='vendor_review'` showing vendor, document,
CUEC text and reviewer. That is the real remaining Vendor Assurance work, and it
is **not** in scope for the extraction fix.

---

## 1. Preconditions

Every one must hold before the first UI action. If any fails, stop.

| # | Precondition | How to confirm | Owner |
|---|---|---|---|
| P-1 | The fix is on the branch staging tracks | `git merge-base --is-ancestor 76ed3f3f <deployed sha>` | Operator |
| P-2 | Staging app reports the intended SHA | `GET https://securelogic-app-staging.onrender.com/api/version` → `commit` matches | Anyone |
| P-3 | **The fix is actually in the deployed engine**, not merely in the branch | See §2 Gate 1 — a behavioural probe, not a SHA check | Anyone |
| P-4 | Engine healthy | `GET /health` → `{"status":"ok","db":"connected"}` | Anyone |
| P-5 | Vendor-extraction worker deployed on the same SHA and **not** running a stale build | `render deploys list srv-<vendor-extraction-worker>` — a failed build silently keeps serving the old one | Operator |
| P-6 | `ANTHROPIC_API_KEY` present and funded on the staging engine **and** worker | Gate 5 fails with `llm_unavailable` if not. A previous outage traced to credit exhaustion | Operator |
| P-7 | Tenant approved: `[SEED] Walkthrough Org` (`295b989a-89d6-49ec-a7ed-deb04489d068`) | — | Operator sign-off |
| P-8 | Two real logins available: proposer **and** approver | The acceptance API defines approver as *a different `user_id`*; it refuses API-key identity. One login cannot drive gate 14 | — |
| P-9 | Org entitlement is `platform` | `/api/auth/me` → `entitlementLevel` | Anyone |
| P-10 | Controls exist, including one **not fully implemented** | Confirmed: *MFA enforcement on privileged accounts* = `partially_implemented` | — |
| P-11 | Org SLA policy populated | Confirmed: Critical 7 / High 14 / Moderate 30 / Low 90 | — |
| P-12 | **Second tenant credential for gate 17** | Not currently held. See §4 | **Operator — blocking for gate 17** |
| P-13 | Prior failed document dispositioned | `11146e8a-…` is terminal `extraction_failed`; leave it as the before-evidence, upload a **new** document | — |

**Operator actions required before re-run:** P-1 (the §0.1 decision), P-5, P-6,
P-7, P-12.

---

## 2. Fixture requirements

### 2.1 The document must be a real one

The first run used a synthetic excerpt. That was right for proving the pipeline
mechanically, and **wrong for proving extraction quality**. The re-run needs a
**genuine SOC 2 Type II report** — a real auditor's report for a real service
organisation, supplied by the operator, that the tenant is entitled to hold.

**Required properties:**

| Property | Requirement | Why |
|---|---|---|
| Format | PDF, text-layer (not scanned images) | `pdf_image_only` is a separate terminal code and would confound the result |
| Size | ≤ 25 MB (`MAX_BYTE_SIZE`) | Hard limit |
| Type | SOC 2 Type II | Matches `document_type_hint = soc2_type2` |
| **Opinion** | **Clean — no testing exceptions** | **This is the whole point.** A clean opinion is the case the fix addresses. A report *with* exceptions would extract on the old code too and would prove nothing |
| CUEC section | Present, with ≥ 4 complementary user entity controls | Gate 7 needs two determinations against different CUECs |
| Content overlap | ≥ 1 CUEC should plausibly map to *MFA enforcement on privileged accounts* | Gives the gap determination a real basis rather than a manufactured one |

**If no clean real report is available**, the run may proceed with a
representative one, but the record must say so and gate 5 is then **DEGRADED,
not PASS** — the specific regression would be untested.

**Handling.** A real vendor's SOC 2 is confidential. Do not commit it to the
repository, do not attach it to a PR, and do not place it anywhere outside the
staging tenant. Reference it in evidence by filename and SHA-256 only.

### 2.2 Recording template — every gate uses this

```
GATE n — <name>
  UI evidence      : screenshot / what was seen on which page, at which URL
  API evidence     : endpoint + response field(s) that corroborate it
  DB corroboration : query + result, ONLY where the UI result needs backing
  Expected         : …
  Actual           : …
  Verdict          : PASS | DEGRADED | FAIL
  Notes            : deviation, workaround used, or defect id
```

**A gate is PASS only if the UI evidence alone establishes the result.** If the
result was only visible via API or SQL, the verdict is **DEGRADED** at best, and
the note must say which step required it.

---

## 3. The gates

Sign in at `https://securelogic-app-staging.onrender.com`.

### Gate 1 — the fix is present in the running engine

Not a SHA check. A SHA proves what was *built*; a failed worker build silently
keeps serving the old code (P-5).

- **Method:** upload a clean-opinion document (gate 3) and observe gate 5. If
  extraction completes, the fix is live. **Also** confirm negatively: the
  previously failed document `11146e8a-…` must still read `extraction_failed`
  — the fix does not retroactively reprocess, and a document that silently
  changed state would mean something else is happening.
- **API corroboration:** `GET /api/version` on the app; deployed-SHA ancestry.
- **Expected:** new document extracts; old document unchanged.
- **Stop condition:** if extraction still fails with
  `material_field_missing_span`, **STOP**. The fix is not deployed. Do not
  continue; do not re-upload repeatedly.

### Gate 2 — tenant

Confirm the header/org switcher shows `[SEED] Walkthrough Org` before any
action. A run against the wrong tenant is void.

### Gate 3 — upload through the UI

- **UI:** Vendors → *Microsoft* (or the vendor matching the real report) →
  the vendor-assurance upload form. **Use the form**, not `curl`.
- **Expected:** the UI accepts the file and returns to a document view showing
  status *pending* or *processing*.
- **Watch for:** an opaque **500**. A wrong multipart field name produced
  `internal_error` rather than a 400 in the first run. From the UI this should
  not occur — the form sends the right field — and if it does, that is a new
  defect, not the known one.

### Gate 4 — storage

- **UI:** the document appears in *Document Queue* and does not show a storage
  error.
- **API corroboration:** `storage_key` is non-null and prefixed
  `org/295b989a-…/vendor-assurance/<id>/original.pdf`.
- **Expected:** PASS. Storage was already proven on staging in the first run.
- **FAIL modes:** `storage_unavailable` / `storage_error` — different defect
  (see PR #827); stop and record.

### Gate 5 — extraction completes ★ the regression under test

- **UI:** the queue row moves *processing → extracted*; the document detail page
  renders extracted fields and a CUEC list.
- **API corroboration:** `processing_status = 'extracted'`,
  `processing_error_code = null`; CUEC count > 0.
- **Expected:** extraction completes; **CUEC count matches the report's CUEC
  section**, not merely non-zero.
- **This is the gate the whole re-run exists for.** If it fails with
  `material_field_missing_span`, STOP (gate 1). If it fails with a *different*
  code, that is a new defect: preserve `processing_error_detail`, capture the
  worker log, classify, and stop.

### Gate 6 — the extraction-review UI

- **UI:** `/vendor-assurance/<documentId>` renders the review surface — extracted
  fields, the CUEC section, and control mappings — **reached by navigation**,
  not by typing an internal id into the address bar.
- **Expected:** reachable from *Vendor Assurance → Document Queue* by clicking.
- **DEGRADED if:** the page renders only when the UUID is pasted in. Navigation
  reachability has previously diverged from feature availability in this repo.

### Gate 7 — two CUEC determinations, through the UI

Both via `CuecDeterminationPanel` buttons.

| | Determination | UI label | CUEC to use |
|---|---|---|---|
| 7a | `satisfied` | **"We meet this"** | one mapping to a control with `implementation_status = implemented` |
| 7b | `gap` | **"We don't meet this"** | one mapping to *MFA enforcement on privileged accounts* (`partially_implemented`) |

- **Expected:** both determinations persist and the panel reflects them on
  reload.
- **DB corroboration:** `review_status` is `satisfied` / `gap` respectively.

### Gate 8 — the reason is required and is entered through the UI

- **8a (negative):** attempt 7b's gap **with the reason box empty**. The UI must
  **refuse** with the `gap_reason_required` message. A gap asserts the
  organisation fails an obligation; it must be defensible.
- **8b (positive):** repeat with a written reason. It persists.
- **Expected:** 8a refused, 8b accepted.
- **FAIL if:** an empty-reason gap is accepted. That is a governance defect, not
  a cosmetic one.

### Gate 9 — determination provenance is preserved

- **UI:** the panel shows **who** decided and **when**, and the CUEC's source
  text is displayed verbatim as extracted.
- **DB corroboration:**
  `review_status_updated_by_user_id`, `review_status_updated_at`,
  `review_status_reason`, and `gap_basis` — which must name the mapped control
  **and its `implementation_status` at the moment of decision**, not as
  recomputed later.
- **Expected:** reviewer identity and timestamp visible in the UI; `gap_basis`
  snapshot correct.
- **DEGRADED if:** reviewer/time exist in the DB but the UI does not show them.

### Gate 10 — promote the gap to a Finding, via the UI action

- **UI:** the *promote* control on the gap CUEC. Not an API call.
- **Expected:** a Finding is created and the panel switches to showing a link to
  it.
- **Also verify (idempotency, UI):** the promote control no longer offers to
  promote again, and re-attempting a determination change on a promoted CUEC is
  refused (`cuec_already_promoted`).

### Gate 11 — severity and policy-driven SLA

- **UI:** choose severity **High** in the promote control; the resulting Finding
  shows a due date.
- **Expected — exact, not approximate:** `due_date = <date of promotion> + 14`,
  from `risk_settings.finding_sla_by_severity.High = 14`. Compute the expected
  date before promoting and compare.
- **DB corroboration:** `findings.due_date`.
- **FAIL if:** due date is null (the SLA policy was not consulted) or any other
  interval (the policy was not the source).

### Gate 12 — the Finding links back ⚠ predicted FAIL

Record each leg separately; do not collapse them into one verdict.

| Leg | Data exists? | UI shows it? | Predicted |
|---|---|---|---|
| Vendor | Yes — `findings.source_id` = vendor id | **No** | **FAIL (UI)** |
| **Engagement** | **No — no such column or FK** | No | **N/A — ADR-0010** |
| Source document | Only transitively, CUEC → document | **No** | **FAIL (UI)** |
| Source CUEC | Yes — `vendor_assurance_cuecs.promoted_finding_id` (reverse lookup) | **No** | **FAIL (UI)** |
| Reviewer determination | Yes — on the CUEC row | **No** | **FAIL (UI)** |

- **Forward direction does work:** CUEC → Finding is a real link in the UI.
  Record it as such — the failure is the **return path**.
- **DB corroboration** (evidence of what the data *could* support, **not** a
  substitute for the UI gate): the org-scoped provenance join in
  `VA-3-STAGING-EXERCISE.md` §6.
- **Do not mark this PASS on the strength of that query.** The gate asks whether
  a user can traverse the chain. Today they cannot.
- **The engagement leg is N/A, not FAIL.** Vendor Assurance and Vendor
  Engagements are two independent evidence spines that share only `vendors.id` —
  separate tables, separate storage helpers, separate workers, separate finding
  source types, and no reference to each other in schema or code. Whether they
  should converge is an open decision (**ADR-0010**), not a bug this re-run can
  find. Scoring it FAIL would report a missing feature as a broken one.

### Gate 13 — the Finding is in the standard workflow

- **UI:** `/findings` lists it; the **Vendor Assessment** source-type filter
  returns it; opening it renders the standard Finding detail page.
- **Expected:** PASS. This is ordinary Findings behaviour.

### Gate 14 — the next governance step

Two parts; both through the UI.

- **14a — remediation:** add a remediation action via `AddActionForm` on the
  Finding. Expected: the action persists and appears on the Finding.
- **14b — risk:** for this fixture, use **Risk Register linkage**, because the
  tenant's Risk Register is **empty** — use the Finding's *promote to risk*
  control (`RiskRegisterPanel`), which creates the Risk **and** the link in one
  act. Verify from both sides: the Finding shows the linked Risk, and the Risk
  shows the Finding.
- **14c — optional, only if the fixture warrants it:** propose a risk
  **exception** as the analyst and approve it **as the approver** (two logins,
  P-8). The finding must **stay open** and `findings.due_date` must be
  unchanged — the original obligation is never rewritten by an exception.

### Gate 15 — Vendor Assurance reporting

- **UI:** the document detail CUEC section reflects the determinations
  (one satisfied, one gap-and-promoted); the *Document Queue* shows the document
  in the correct state.
- **Export:** generate the **XLSX** and **PDF** exports from the document page
  and confirm the CUEC rows carry their determinations and the promoted-finding
  reference.
- **Expected:** the gap and its promotion are visible without opening the
  database.
- **DEGRADED if:** determinations appear only in the export and not on screen,
  or vice versa.

### Gate 16 — audit trail ⚠ predicted DEGRADED

- **Finding side (UI):** the Finding history section shows creation and
  subsequent decisions. Expected PASS.
- **Determination/promotion side:** the events
  `vendor_assurance.cuec.promoted_to_finding` (resource type
  `vendor_assurance_cuec`) and the determination event exist in the audit log,
  but **no Vendor Assurance audit UI exists**. Reachable only by API/SQL.
- **Verdict:** **DEGRADED**, with the note that the consequential VA actions are
  audited but not *visible*.

### Gate 17 — cross-org negative check ⚠ needs P-12

The tenant-isolation gate. **Blocked until a second staging tenant credential is
provided.**

- **Method:** sign in as a user of a *different* staging organisation and
  attempt, in order: open the document URL; open the Finding URL; call
  `GET /api/vendor-assurance/documents/<id>`; call
  `POST /api/vendor-assurance/cuecs/<cuecId>/review-status`; call
  `GET /api/findings/<id>`.
- **Expected:** **404** on every one — not 403. The codebase's stated posture is
  that a cross-org read must not reveal that the resource exists.
- **This is the one gate where direct API calls are correct**, because the point
  is to probe what an attacker could reach, not what the UI offers.
- **FAIL is a P0.** Stop everything, preserve evidence, escalate. Do not
  continue the run.

### Gate 18 — log sweep

After all gates, sweep the staging engine and vendor-extraction worker logs for
the run window:

```
render logs --resources <engine-srv-id> --limit 200 --text vendor_assurance
render logs --resources <engine-srv-id> --limit 200 --level error
render logs --resources <worker-srv-id> --limit 200 --level error
```

- **Look for:** new `extraction`, `authorization`, `storage` or `processing`
  errors; `unhandled_request_error`; `llm_unavailable`; any cross-tenant warning.
- **Expected:** no new error classes beyond those already recorded.
- **Note:** `--start` combined with `--level` has silently returned empty in
  this environment. Use `--limit`, not `--start`.

---

## 4. Cross-org tenant (P-12)

Gate 17 needs a second staging organisation with a real login. `[SEED]
Walkthrough Org` is the only tenant this session holds credentials for.

**Do not** use `Meridian Financial Services` — that is the sales/demo seed, and
the governing docs forbid substituting Demo for Staging. `Staging Inc` is
reported to have duplicates on staging and is not a clean isolation subject.

**Operator to nominate** a second staging tenant and supply a login, or confirm
that gate 17 is deferred — in which case the final verdict cannot exceed
DEGRADED, because tenant isolation is the one property this product cannot
claim on harness evidence alone.

---

## 5. Evidence classification

Every line of the record must be tagged. Conflating these is how a product gets
called finished.

| Tier | Meaning | Use in this run |
|---|---|---|
| **STAGING** | Observed in the staging product, by a user, in a browser | The only tier that counts toward a VA-3 PASS |
| **HARNESS** | Proven by automated tests, including real-Postgres isolation suites | **Never** substitutes for a gate. PR #855's 246 targeted tests and 1,476 isolation tests are HARNESS |
| **PRODUCTION** | Observed in production | **Out of scope.** Production is not touched. Vendor Assurance is flag-on in production with **no R2 configured on the engine**, so this workflow is not exercisable there at all |

**Do not** record a gate as passing on HARNESS evidence. If the UI could not
demonstrate it, the gate did not pass.

---

## 6. Stop conditions

Stop immediately, preserve evidence, classify, and do not work around:

1. **Gate 1** — extraction still fails with `material_field_missing_span`. The
   fix is not deployed; nothing after this is meaningful.
2. **Gate 5** — extraction fails with any **new** error code. Capture
   `processing_error_detail` and the worker log before touching anything.
3. **Gate 8a** — an empty-reason gap is accepted. Governance defect.
4. **Gate 11** — due date null or not policy-derived. The SLA chain is broken.
5. **Gate 17** — any cross-org read or write succeeds. **P0. Stop everything.**
6. **Any gate** requiring a manual API call, an internal id typed into a URL, a
   SQL write, or an engineer's help to proceed. Record it as the defect it is
   rather than completing the run by hand.

**Never** re-run a failed step repeatedly hoping for a different result. LLM
extraction is nondeterministic and a lucky retry would produce a false PASS —
which is exactly the failure mode this whole package exists to eliminate.

---

## 7. Cleanup and evidence retention

**Keep, do not delete:**

- The **new** document and its full chain — CUECs, determinations, Finding,
  action, Risk, audit rows. This is the evidence that Vendor Assurance works
  end to end, and it is the first such record that would ever have existed.
- The **old failed** document `11146e8a-…`, in `extraction_failed`. It is the
  before-picture and the proof that the fix changed something real.

**Remove:** nothing, until VA-3 is signed off.

**After sign-off**, if the tenant needs to be returned to a known state:

```
scripts/validation/seed-walkthrough-org.ts --reset
```

Confirm first that the script does what is wanted here: it is a **seed reset**,
not a targeted delete, and a related reset script has previously failed when run
as a Render job. Read it before relying on it. Record the removal in the VA-3
record with the date and who ran it.

**Confidential fixture:** if a real vendor's SOC 2 was uploaded, decide
deliberately whether it may remain in the staging tenant. Default to **removing
the document while keeping the derived rows**, so the evidence chain survives
without the source PDF sitting in a non-production environment. Record which was
chosen.

---

## 8. Rollback and abort

The re-run creates data; it changes no code and no configuration.

| Situation | Action |
|---|---|
| Run abandoned mid-way | Leave the partial chain in place and record where it stopped. Do not tidy it away — a partial chain is evidence |
| Staging destabilised | The re-run cannot destabilise it: no deploy, no migration, no flag change |
| The **fix** needs reverting | One-line revert of `76ed3f3f`. No data migration: documents extracted under the widened waiver stay valid, since the extraction record's shape is unchanged |
| Freeze broken to deploy the fix (§0.1 option A) | Re-mint the candidate, re-run CI on the new SHA, and re-confirm R-1 blocker K-1. The migration inventory and rollback rehearsal are unaffected — the migration set does not change |

**Production is not touched by any part of this plan.** **#826 must not be
disturbed** — which is the main argument for §0.1 option C.

---

## 9. The final VA-3 gate

**PASS only if the entire chain works, in the UI:**

```
Document → Extraction → Human Review → CUEC Determination
         → Finding Promotion → SLA → Remediation/Risk → Reporting/Audit
```

| Verdict | Condition |
|---|---|
| **PASS** | Every gate 1–18 passes on STAGING evidence, with no manual API call, internal id, SQL write or engineering intervention anywhere in the path |
| **DEGRADED** | The chain completes, but one or more gates required corroboration the UI could not provide — **the predicted outcome on current code**, because of gate 12 |
| **FAIL** | The chain breaks at any gate |

**Honest expectation: DEGRADED.** The extraction fix unblocks gates 5–11 and
13–15. It does not create the Finding→provenance UI that gate 12 asks for, and
it does not create an engagement↔document relationship that does not exist in
the schema — **and that second one should not be treated as in scope for VA-3 at
all** until ADR-0010 is decided.

**Vendor Assurance should not be called DONE on a DEGRADED result.** The
remaining work is a scoped UI package — a provenance block on the Finding detail
page for `source_type='vendor_review'`, which is Option 4 in ADR-0010 — plus the
ADR-0010 decision itself on whether the engagement spine and the document spine
are meant to converge. That second question is an architecture decision, not a
bug, and it should be answered deliberately, with a design partner in the room,
rather than discovered in front of one.
