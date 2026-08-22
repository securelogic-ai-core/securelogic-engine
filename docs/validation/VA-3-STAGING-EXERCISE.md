# VA-3 — Vendor Assurance staging operational exercise

**Opened:** 2026-08-21. **Environment:** staging only. Production was not
touched. **Tenant:** `[SEED] Walkthrough Org` (`295b989a-89d6-49ec-a7ed-deb04489d068`),
the canonical staging validation tenant.

**Why this package exists.** VA-2 named the staging operational exercise as the
last item in the Sept 15 definition of done for Vendor Assurance. Until it runs,
the flagship Sept 15 domain rests entirely on HARNESS evidence, against a
standing fact: **documents have been ingested and zero findings have ever come
out of the document path in any environment.**

**Status:** **BLOCKED — one HIGH-severity product defect found (§4.3).**
Every precondition passed and the ingestion path was exercised end to end;
extraction then failed on the most common class of SOC 2 report, producing
zero CUECs and stopping the workflow at its first step. The browser-driven
half (§5) is operator-owed and cannot start until the defect is fixed.

---

## 1. Deployed state under test

| Fact | Value | How verified |
|---|---|---|
| Staging app commit | `65cd3330` | `GET /api/version` |
| Staging app branch | `develop` | same |
| Deployed at | 2026-08-21T20:31:58Z | same |
| Staging engine `/health` | `{"status":"ok","db":"connected"}` | live |
| Promotion candidate | `65cd3330` | `docs/release/RELEASE-BOUNDARY-FREEZE.md` |

Staging redeployed automatically when PR #853 merged (all seven staging services
are pinned to `develop`). The change was documentation-only, so **the tree under
test is functionally identical to `4fe16808`**, which is what VA-3 was scoped
against.

## 2. Pre-flight — every precondition checked before opening a browser

All checks are live API calls against staging as `walkthrough-analyst`.

| # | Precondition | Result |
|---|---|---|
| P-1 | Engine reachable, DB connected | **PASS** |
| P-2 | VA routes live behind auth (401, not 404 ⇒ flag on) | **PASS** |
| P-3 | Both walkthrough logins succeed (proposer **and** approver — the acceptance API defines "approver" as *a different user_id*, so two real logins are mandatory) | **PASS** |
| P-4 | Org entitlement is `platform` — clears `requireEntitlement("premium")` and the `access: "platform"` nav gate | **PASS** |
| P-5 | Vendors exist to attach a document to | **PASS** — Microsoft, Cisco |
| P-6 | Controls exist for CUEC→control mapping | **PASS** — 3 controls |
| P-7 | **A control exists that justifies a real `gap`** | **PASS** — *MFA enforcement on privileged accounts* is `partially_implemented` |
| P-8 | Org SLA policy configured, so a promoted finding gets a due date | **PASS** — Critical 7 / High 14 / Moderate 30 / Low 90 days |
| P-9 | Risk-acceptance/exception surface live (`SECURELOGIC_RISK_ACCEPTANCE_ENABLED`) | **PASS** — `GET /api/risk-acceptances` → 200, 1 active acceptance already present |
| P-10 | `GET /findings/:id/risk-links` live (SL-RISK-LINK) | **PASS** — 200 |
| P-11 | `GET /findings/:id/occurrences` live (SL-OCC-1) | **PASS** — 200 with rollup |
| P-12 | Vendor-assurance documents in this tenant | **0** — clean slate, ideal |
| P-13 | **Risk Register entries in this tenant** | **0 — see §3.1** |
| P-14 | Object storage reachable from the staging engine | **PASS — proven by §4** |

### 2.1 P-8 makes the due-date criterion predictable

Because `risk_settings.finding_sla_by_severity` is populated, a gap promoted at
**High** severity must produce `due_date = CURRENT_DATE + 14`. That is an exact,
checkable value, not "a due date appeared".

## 3. Two gaps in the DONE definition, found by pre-flight

### 3.1 The Risk Register is empty — the link step has nothing to link to

VA-3's DONE definition says the promoted finding must be *"linked to the Risk
Register"*. The tenant holds **zero risks**, so `POST /findings/:id/risk-links`
has no target.

**Resolution — no seeding needed.** `findingRiskLinks.ts` exposes
`POST /api/findings/:id/promote-to-risk`, which creates the Risk Register entry
*and* the link in one act. The exercise should use that, then verify the link
via `GET /findings/:id/risk-links` and `GET /risks/:id/findings`.

### 3.2 "All four determination states" — naming them precisely

The DB CHECK admits five values; one is deprecated. The four states the exercise
must exercise, with their UI labels from `CuecDeterminationPanel.tsx`:

| State | UI label |
|---|---|
| `pending` | the initial state; reachable again by clearing a determination |
| `not_applicable` | **"Doesn't apply to us"** |
| `satisfied` | **"We meet this"** |
| `gap` | **"We don't meet this"** |

`reviewed_no_match` is **deprecated** and must not be exercised. It is retained
only so legacy rows do not violate the CHECK, and is never auto-migrated because
reinterpreting it would invent a determination nobody made.

## 4. Executed so far — the ingestion path

### 4.1 Test artifact

A **synthetic, clearly-labelled** SOC 2 excerpt was generated for this exercise:
3 pages, 7 CUEC statements, a fictional service organisation ("Northwind Cloud
Services"), with *"SYNTHETIC TEST ARTIFACT — NOT A REAL AUDIT REPORT"* on the
first and last page. It is deliberately **not** a real vendor's report.

CUEC-01 and CUEC-03/04 are written to map onto the tenant's existing controls,
so the determination step has a real basis rather than a manufactured one:

- **CUEC-01** — MFA on privileged/administrative accounts → maps to *MFA
  enforcement on privileged accounts*, which is **`partially_implemented`**.
  This is the intended `gap`.
- **CUEC-03** — documented incident response plan → *Security incident response
  plan* (`implemented`) → the intended `satisfied`.
- **CUEC-04** — EDR agents on administrative devices → *Endpoint detection and
  response coverage* (`implemented`).
- CUEC-02, 05, 06, 07 have no mapped control — useful for `not_applicable` and
  for observing how the matcher behaves with no candidate.

### 4.2 Upload — PASS

```
POST /api/vendor-assurance/documents   (multipart: document, vendor_id, document_type_hint)
→ HTTP 202
  id            11146e8a-b45b-452b-9c3a-8734f82ca9b6
  vendor        Microsoft (2de21b7e-…)
  sha256        3970ea7a3fc1ce034bd28b1b297960f0336a010720a94e119db7ca3517db8ca6
  storage_key   org/295b989a-…/vendor-assurance/11146e8a-…/original.pdf
  status        pending
```

**This proves staging object storage is configured and reachable** — the R2 PUT
completed and a storage key was assigned. P-14 closed.

### 4.3 Extraction — **FAILED, and the failure is a product defect**

The vendor-extraction worker claimed the document, moved it to `extracting`,
and then terminated it:

```
processing_status        extraction_failed
processing_error_code    llm_invalid_json
processing_error_detail  material_field_missing_span: exceptions
CUECs extracted          0
```

Zero CUECs means **VA-3 stops at step 1**. No CUECs → no determinations → no
gap → no finding. The rest of §5 cannot be driven against this document.

**This is not a bad-document problem. It is a validator defect, and it is
proven, not inferred.**

`socExtractionPrompt.ts` marks `exceptions` and `management_responses` as
`requiresSourceSpan: true`, both `array_of_objects`.
`socExtractionValidator.ts` waives the span requirement for a field whose value
is absent — but the waiver tests for `null` **only**:

```ts
for (const required of FIELD_NAMES_REQUIRING_SPANS) {
  if (fields[required]?.value === null) continue;   // <-- null only
  if (!spannedFields.has(required)) {
    return { ok: false, error: "material_field_missing_span", detail: required };
  }
}
```

An **empty array is not null.** When a report contains no testing exceptions,
the natural model output for "there were none" is `[]`, not `null` — and there
is nothing in the document to quote for it. The validator then demands a span
for a list that is empty by definition and rejects the entire extraction.

The module's own docstring states the intended invariant:

> *"spanned ⇒ there is a value to span — a field legitimately absent from the
> source document cannot carry a quote, so demanding one is incoherent."*

`[]` is exactly such a field. The rule is right; the test for it is too narrow.

**Reproduced deterministically** — `src/api/__tests__/va3CleanSoc2ExtractionRepro.test.ts`
(untracked; written for this exercise, **not committed** — `develop` is frozen).
Two cases over an otherwise-identical, fully-valid extraction:

| `exceptions` / `management_responses` value | Result |
|---|---|
| `null` | **extraction SUCCEEDS** |
| `[]` | **fails `material_field_missing_span: exceptions`** |

Both assertions pass. Nothing else differs between the two runs.

#### Why this matters more than one failed test upload

A SOC 2 Type II with **no testing exceptions is a clean opinion** — the normal,
desirable result for a reputable vendor, and a large share of the reports
customers will upload. For those documents, whether ingestion succeeds depends
on whether the model happens to emit `null` or `[]` for a field that means "there
were none". **That is nondeterministic model formatting deciding whether a
customer's document ingests at all.**

It is a credible contributor to the standing fact this package exists to test:
**documents ingested, zero findings ever produced through the document path.**

#### Severity and disposition

- **Severity: HIGH for the Sept 15 Vendor Assurance claim.** It blocks the
  flagship workflow on the most common class of input.
- **Not a promotion blocker.** The behaviour is identical on `main` and
  `develop`; the promotion neither creates nor worsens it.
- **It IS a VA-3 blocker.** VA-3 cannot reach DONE until it is fixed and the
  exercise re-run.
- **Terminal, not retried.** `extraction_failed` is a terminal state, so the
  document does not recover on its own. Re-upload after a fix, or drive
  `POST /vendor-assurance/documents/:id/request-manual-review`.

#### Suggested fix — one line, plus the test above

Widen the waiver from "value is null" to "value is null **or** an empty array":

```ts
const v = fields[required]?.value;
if (v === null || (Array.isArray(v) && v.length === 0)) continue;
```

This preserves the real invariant — a non-empty material conclusion must be
grounded in a quote — while ceasing to demand evidence for the absence of
something. It belongs with PR #827, which is already reworking error
truthfulness on this route, and both are held behind #826.

**Caveat, stated honestly.** The document under test is synthetic and contains
no exceptions section at all, so this run alone does not prove how a *real*
clean SOC 2 behaves end to end. What is proven is the validator asymmetry, by
direct test against the shipped module. Re-running against a real clean SOC 2
report is part of the operator's §5 work once the fix lands.

### 4.4 A real defect found on the way in

The first upload attempt used multipart field name `file`; the handler declares
`upload.single("document")`. The response was:

```
HTTP 500  {"error":"internal_error","requestId":"5a544233-…"}
```

Engine log for that request:

```
MulterError: LIMIT_UNEXPECTED_FILE — "Unexpected field"
event: unhandled_request_error
```

**A malformed multipart field name produces an opaque HTTP 500, not a 400.**
Multer's error escapes to the generic handler, so the caller is told the server
broke when in fact their request was malformed. Every other input error on this
route returns a specific 400 (`vendor_id_must_be_uuid`,
`invalid_document_type_hint`, `pdf_magic_bytes_missing`, …), so this one path is
inconsistent with the route's own contract.

**Severity: low. Not a promotion blocker, and not a VA-3 blocker** — the product
UI always sends the right field name, so only an API client can hit it. It is
recorded because it is exactly the class of thing this exercise exists to find,
and because a 500 sends a support ticket down the wrong path (SR-016 → "storage
or extraction fault") when the answer is "your request was malformed".

**Suggested fix:** a multer error handler on the route converting
`LIMIT_UNEXPECTED_FILE` → `400 {"error":"document_field_required"}` and
`LIMIT_FILE_SIZE` → `413`. Belongs with #827, which is already reworking error
truthfulness on this exact route.

## 5. Operator-owed: the browser half

Browser automation is unavailable here, and VA-3's DONE definition requires the
workflow to be driven **in a browser**. Everything below is the operator's, and
the pre-flight above means none of it should fail on a precondition.

**Sign in:** `https://securelogic-app-staging.onrender.com` as
`walkthrough-analyst@seed.securelogicai.test` (proposer, `member`) and
`walkthrough-approver@seed.securelogicai.test` (approver, `admin`).

**Navigate:** Vendor Assurance → Document Queue → the Northwind document, or
directly `/vendor-assurance/11146e8a-b45b-452b-9c3a-8734f82ca9b6`.

| Step | Action | Evidence to record |
|---|---|---|
| 1 | Confirm extraction completed and CUECs are listed | CUEC count; do the 7 synthetic CUECs appear, and is the text faithful? |
| 2 | Review CUEC→control mappings | Which mapped automatically; accept/dismiss at least one |
| 3 | **"Doesn't apply to us"** on a CUEC with no mapped control | `review_status = not_applicable`, reviewer + timestamp recorded |
| 4 | **"We meet this"** on CUEC-03 | `review_status = satisfied`, `gap_basis` snapshot names the mapped control and its status **at that moment** |
| 5 | **Clear a determination back to `pending`** | reviewer, timestamp, reason and `gap_basis` all return to NULL |
| 6 | **"We don't meet this" with NO reason** on CUEC-01 | **must be REFUSED** — `gap_reason_required`. This is the negative test the DONE definition calls out |
| 7 | Repeat step 6 **with** a reason | `review_status = gap`, reason stored, `gap_basis` snapshots *MFA enforcement…* as `partially_implemented` |
| 8 | Promote the gap to a Finding at **High** severity | Finding created; `source_type = vendor_review`; `source_id` = the **vendor**; `decision_state = needs_review`; **`due_date = today + 14`** |
| 9 | Re-attempt promotion on the same CUEC | must return the existing finding with `created: false`, not a duplicate |
| 10 | Try to change the determination after promotion | **must be REFUSED** — `409 cuec_already_promoted` |
| 11 | Promote the Finding to the Risk Register (§3.1) | Risk created and linked; visible from both `/findings/:id/risk-links` and `/risks/:id/findings` |
| 12 | Propose a risk **exception** (not an acceptance) as the analyst | `kind = exception`, `sla_due_date_at_request` frozen to the finding's due date |
| 13 | Approve it **as the approver** | separation of duties satisfied; **the finding must stay OPEN** — this is SL-EXC-1's whole point |
| 14 | Confirm `findings.due_date` is unchanged by the exception | the original obligation must not be rewritten |

## 6. Provenance — the reconstruction query

VA-3's final criterion is that provenance be reconstructable by join:
**vendor → document → CUEC → reviewer → finding.**

One subtlety, established by reading the promotion handler: the finding's
`source_id` points at the **vendor**, not at the document or the CUEC. **The
only link from finding back to CUEC is `vendor_assurance_cuecs.promoted_finding_id`
— a single column.** (R-1 §E.6 notes the same column is dropped by a rollback,
which is what would sever this chain.)

```sql
SELECT v.name                                   AS vendor,
       d.original_filename                      AS document,
       d.sha256                                 AS document_sha256,
       c.ordinal                                AS cuec_no,
       left(c.cuec_text, 80)                    AS cuec,
       c.review_status                          AS determination,
       c.review_status_reason                   AS reviewer_reason,
       u.email                                  AS reviewed_by,
       c.review_status_updated_at               AS reviewed_at,
       c.gap_basis                              AS basis_at_decision,
       f.id                                     AS finding_id,
       f.title, f.severity, f.due_date,
       f.decision_state, f.operational_status,
       r.id                                     AS risk_id,
       r.title                                  AS risk_title,
       fra.kind                                 AS acceptance_kind,
       fra.state                                AS acceptance_state,
       fra.sla_due_date_at_request              AS due_date_frozen_at_request
  FROM vendor_assurance_cuecs c
  JOIN vendor_assurance_documents d ON d.id = c.document_id
                                   AND d.organization_id = c.organization_id
  JOIN vendors v                    ON v.id = d.vendor_id
                                   AND v.organization_id = d.organization_id
  LEFT JOIN users u                 ON u.id = c.review_status_updated_by_user_id
  LEFT JOIN findings f              ON f.id = c.promoted_finding_id
                                   AND f.organization_id = c.organization_id
  LEFT JOIN finding_risks fr        ON fr.finding_id = f.id
                                   AND fr.organization_id = f.organization_id
  LEFT JOIN risks r                 ON r.id = fr.risk_id
                                   AND r.organization_id = fr.organization_id
  LEFT JOIN finding_risk_acceptances fra ON fra.finding_id = f.id
                                        AND fra.organization_id = f.organization_id
 WHERE c.organization_id = '295b989a-89d6-49ec-a7ed-deb04489d068'
   AND d.id = '11146e8a-b45b-452b-9c3a-8734f82ca9b6'
 ORDER BY c.ordinal;
```

**Every join is org-scoped on both sides.** That is not decoration: it is the
tenant-isolation standard, and a provenance query that drops it is a
cross-tenant read waiting to happen.

**PASS condition:** one row per CUEC; the gap row carries a reviewer email, a
reason, a `gap_basis` naming *MFA enforcement on privileged accounts* as
`partially_implemented`, a finding with a due date 14 days out, a linked risk,
and an **approved exception** on a finding whose `operational_status` is still
open.

## 7. Standing facts this exercise is testing

| Claim | Status |
|---|---|
| "Zero findings have ever come out of the document path" | **Still true, and now partly explained.** Upload and worker dispatch are proven on staging; **extraction fails on a clean report** (§4.3) |
| "Vendor Assurance is NOT DONE" | **Confirmed, with a named blocking defect** (§4.3), not merely unproven |
| ~~Production Vendor Assurance has no object storage~~ | **WITHDRAWN 2026-08-22.** All five R2 variables are **SET** on the live production engine (dashboard-set; `render.yaml` does not declare them, which is where the wrong inference came from). What stands: the flag is `true` in production, the route answers 401, and the app renders legacy navigation with no vendor-assurance entry — reachable by URL, not by navigation. Storage *reachability* remains unproven pending #827's `HeadBucket` probe |

## 8. Cleanup

The uploaded document `11146e8a-b45b-452b-9c3a-8734f82ca9b6` and everything
derived from it (CUECs, determinations, findings, risks, acceptances) are
**deliberately left in place** as the evidence record for this exercise. They
live only in the staging validation tenant. Remove them with
`scripts/validation/seed-walkthrough-org.ts --reset` when the exercise is signed
off, and record the removal here.
