# Vendor-Assurance Intelligence — Phase 1 Staging Validation Worksheet

**Package:** `vendor-assurance-intelligence-phase-1`
**Environment:** `securelogic-engine-staging` only.
**Acceptance gate:** ≥ 30 real SOC reports across ≥ 3 distinct auditors and ≥ 2 SOC types (SOC 1, SOC 2 Type I or II), drawn from existing customer relationships only, finalized end-to-end on staging.

This worksheet is the durable trail required by the Phase 1 stop point. Populate during validation; do not delete or rewrite — append.

---

## 0. Preconditions

| Item | Status | Notes |
|---|---|---|
| Phase 0 R2 blob primitive deployed to staging engine | ☐ | commit SHA: __ |
| `R2_*` env vars populated on staging engine | ☐ | dashboard timestamp: __ |
| `SECURELOGIC_VENDOR_ASSURANCE_ENABLED=true` set on staging engine | ☐ | dashboard timestamp: __ |
| Migration `20260610_vendor_assurance_documents.sql` applied on staging | ☐ | applied_at from `schema_migrations`: __ |
| Phase 1 tests green in CI | ☐ | run id: __ |

---

## 1. Smoke set (3–5 reports)

Records the wiring is alive end-to-end. **Does not** count toward the acceptance gate.

| # | Vendor | Filename | Auditor | SOC type | Walked end-to-end? | Notes |
|---|---|---|---|---|---|---|
| S1 |  |  |  |  | ☐ |  |
| S2 |  |  |  |  | ☐ |  |
| S3 |  |  |  |  | ☐ |  |

---

## 2. Acceptance corpus (≥ 30 reports)

Acceptance requires ≥ 30 reports across ≥ 3 distinct auditors and ≥ 2 SOC types.

### Per-document log

For each report, capture: report type, auditor, page count, byte size, time-to-finalize, and per-field outcomes. Use the per-field outcome buckets:

- **OK-HC** — extracted with high confidence and value matched ground truth
- **OK-LC** — extracted with low/medium confidence but value matched ground truth
- **WRONG** — extracted but value did not match ground truth
- **MISSED** — model failed to extract
- **SPAN-OK** — source span pointed to correct text in PDF
- **SPAN-WRONG** — source span pointed to incorrect/unrelated text
- **SPAN-N/A** — field does not require source span

| # | Vendor | Auditor | SOC type | Pages | Bytes | Time-to-finalize | Field outcomes (counts) | Notes |
|---|---|---|---|---|---|---|---|---|
| 01 |  |  |  |  |  |  | OK-HC: __ / OK-LC: __ / WRONG: __ / MISSED: __ / SPAN-OK: __ / SPAN-WRONG: __ |  |
| 02 |  |  |  |  |  |  |  |  |
| ... |  |  |  |  |  |  |  |  |
| 30 |  |  |  |  |  |  |  |  |

### Corpus-level distribution

Auditors represented (≥ 3 required):
- __

SOC types represented (≥ 2 required):
- __

---

## 3. Failure-mode validation

Each row produced on staging with a representative failure case.

| Failure case | Expected behavior | Document id | Status code observed | Notes |
|---|---|---|---|---|
| image-only scanned PDF | `extraction_failed:pdf_image_only` | __ | __ |  |
| non-SOC PDF (marketing whitepaper) | extraction completes; fields mostly low-confidence; workflow handles gracefully | __ | __ |  |
| `ANTHROPIC_API_KEY` removed | `extraction_failed:llm_unavailable` | __ | __ |  |
| Anthropic 401 / balance error | `extraction_failed:llm_failed` with detail captured | __ | __ |  |
| upload PDF then archive vendor | review still works OR fails predictably (document which) | __ | __ |  |
| cross-org GET document | 404 | __ | __ |  |
| cross-org pre-signed URL fetch | 404, no URL issued in audit log | __ | __ |  |
| feature flag off | every route returns 404 | __ | __ |  |

---

## 4. Append-only review-decision spot check

Pick three different documents, three different fields, and walk each through accept → edit → reject (three decision rows total per field). Confirm:

- `vendor_assurance_review_decisions` contains all three rows
- `SELECT DISTINCT ON (field_name) ... ORDER BY field_name, decided_at DESC, id DESC` returns the latest (reject)

| Doc id | Field | accept row id | edit row id | reject row id | latest projection returns reject? |
|---|---|---|---|---|---|
| __ | __ | __ | __ | __ | ☐ |
| __ | __ | __ | __ | __ | ☐ |
| __ | __ | __ | __ | __ | ☐ |

---

## 5. Audit-log spot check

Confirm `security_audit_log` for the staging org carries the expected `event_type` for every workflow step, with `organization_id` populated.

| Event type | Found in log? | Sample row id |
|---|---|---|
| `vendor_assurance.document.uploaded` | ☐ | __ |
| `vendor_assurance.extraction.started` | ☐ | __ |
| `vendor_assurance.extraction.completed` | ☐ | __ |
| `vendor_assurance.extraction.failed` | ☐ | __ |
| `vendor_assurance.review_decision.recorded` | ☐ | __ |
| `vendor_assurance.document.finalized` | ☐ | __ |
| `vendor_assurance.document.pdf_url_issued` | ☐ | __ |

---

## 6. Reviewer time-to-finalize

| Statistic | Value |
|---|---|
| n (acceptance corpus) | __ |
| median minutes | __ |
| 90th percentile minutes | __ |

If median > 15 min, flag as a UX concern in the Phase 2 go/no-go summary; do not auto-block this package.

---

## 7. Production posture confirmation

| Item | Status |
|---|---|
| Production engine R2 env vars unset | ☐ |
| Production engine `SECURELOGIC_VENDOR_ASSURANCE_ENABLED` unset | ☐ |
| No production deploys in this package | ☐ |

---

## 8. Acceptance summary (filled in at stop point)

- corpus size finalized: __
- distinct auditors: __
- SOC types: __
- failure modes confirmed: ☐
- append-only spot check confirmed: ☐
- audit-log spot check confirmed: ☐
- production posture confirmed: ☐

Phase 2 go/no-go recommendation: __
