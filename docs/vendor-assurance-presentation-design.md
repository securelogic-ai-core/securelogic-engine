# Vendor-Assurance Document Presentation — design decisions

**Package:** `vendor-assurance-document-presentation`
**Status:** built on `develop` (not promoted to `main`); engine + app changes; one migration `db/migrations/20260612_vendor_assurance_document_presentation.sql`.

This package replaces the flat 14-card per-field Accept/Edit/Reject + Finalize review UI with an enterprise document-review surface: the source PDF on the left (react-pdf via a same-origin stream-through proxy), three logical sections on the right (Cover Sheet / Complementary User Entity Controls / Exceptions and Deviations) with human-readable labels, inline field overrides captured via a modal with a required reason, and document-level review actions (Approve / Request Manual Review / Reject Extraction) in a sticky header.

Architecture: **engine routes do persistence + audit; app server actions are thin Bearer-auth proxies** — same shape as `app/src/app/vendors/[id]/actions.ts`. The migration is engine-side; the app does no DB access and writes no audit events directly.

---

## 1. The five product decisions

| # | Decision | Why |
|---|---|---|
| 1 | **Field grouping lives in the UI layer** (`app/src/lib/vendorAssurance/fieldGroups.ts`), not the extraction schema. The engine still stores one flat `fields` JSONB keyed by the closed `MATERIAL_FIELD_NAMES` set. | The schema is document-type-agnostic; section layout is a presentation concern. When the platform supports multiple assurance document types (ISO 27001 certs, pen-test reports, …) with their own layouts, this map moves down to a schema/registry layer keyed by document type. Until then, keeping it in the app keeps the page declarative without a schema change. |
| 2 | **PDF rendered with `react-pdf` 9.x** (bundles `pdfjs-dist` 4.x). The pdf.js worker is committed at `app/public/pdf.worker.min.mjs` (the version pinned by `app/package-lock.json`) and served same-origin; `pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs"`. The viewer is dynamic-imported with `ssr: false`. | react-pdf / pdf.js reference browser-only globals at module-eval time and cannot SSR. `ssr: false` on `next/dynamic` is not permitted inside a Server Component, so the document page imports `PdfPreviewLoader` (`"use client"`), which dynamic-imports `PdfPreview` with `ssr: false`. |
| 3 | **Field overrides captured via a modal with a REQUIRED reason**; the override is append-only and audit-logged. | Overriding an extracted material conclusion is an auditable decision. A required free-text reason on every override gives the audit trail "why", not just "what changed". |
| 4 | **Status semantics = Model B: `approved` replaces `finalized`.** The new UI produces `approved` / `manual_review_requested` / `rejected`; it never writes `finalized`. `finalized` stays in the CHECK list for backward compatibility, and the legacy `POST /finalize` route is left in place (its removal, with the `vendor_assurance_review_decisions` table, is a separate cleanup package). | The old per-field decide → finalize flow is being torn out at the UI layer. The natural new terminal-success state for the document-level flow is "approved", semantically the same step Finalize used to be. Keeping `finalized` legal avoids touching existing rows or the legacy route. |
| 5 | **PDF served via a same-origin stream-through proxy** (`app/src/app/api/vendor-assurance/[documentId]/pdf/route.ts`): the proxy authenticates from the session cookie, calls the engine `/pdf` endpoint with the Bearer token (`redirect: "manual"`), follows the engine's 302 to the pre-signed R2 URL server-side, and streams the bytes back. The browser never sees the engine URL or the pre-signed URL. | A browser redirect to R2 would require CSP `connect-src` to allow the R2 host, would leak short-lived pre-signed URLs into browser history / referer logs, and would put the bytes on a different origin — breaking the planned span-highlighting overlay (Package 1.5). Stream-through is the enterprise-correct pattern. |

---

## 2. Field-grouping table

| Section | Fields (in display order) | Labels |
|---|---|---|
| **Cover Sheet** | `vendor_name`, `report_type`, `report_period_start`, `report_period_end`, `report_issued_date`, `auditor_name`, `auditor_opinion`, `trust_services_criteria`, `subservice_method`, `subservice_organizations`, `controls` | Vendor name · Report type · Report period start · Report period end · Report issued date · Auditor · Auditor opinion · Trust Services Criteria · Subservice method · Subservice organizations · Controls |
| **Complementary User Entity Controls** | `cuecs` | Complementary user entity controls |
| **Exceptions and Deviations** | `exceptions`, `management_responses` | Exceptions · Management responses |

`controls` lives on the Cover Sheet as the "what was tested" summary rather than getting its own section. Labels mirror `MATERIAL_FIELDS[].label` in `src/api/lib/socExtractionPrompt.ts` (kept in sync by hand — the engine and app are separate packages; the UI falls back to the raw field name if a label drifts).

Per the constraint *do not modify the SOC extraction prompt or validator*, the Exceptions section renders only the schema's actual per-exception fields — `control_id`, `description`, `auditor_assessment` — and joins `management_responses` to exceptions by `exception_ref`. **CUECs** render as a list of strings; if a source span happens to be tagged `field_name: "cuecs"` it is shown inline as supporting evidence beneath the list, but no per-item span structure is implied.

---

## 3. Override audit-trail shape

**Storage** — `vendor_assurance_field_overrides` (append-only):

```
id                    uuid pk
organization_id       uuid  fk organizations  not null
document_id           uuid  fk vendor_assurance_documents  not null
field_name            text  not null            -- one of MATERIAL_FIELD_NAMES
original_value         jsonb null                -- the value the reviewer was overriding: the latest PRIOR override's value if one exists, else the original extraction value (null when the field was never extracted)
override_value         jsonb null                -- the reviewer's substitute (SQL NULL when overridden to "none")
reason                text  not null             -- route validator additionally rejects empty/blank; clamped to 1000 chars
overridden_by_user_id uuid  fk users  null  ON DELETE SET NULL
overridden_at         timestamptz not null default now()
```

No `UNIQUE (document_id, field_name)`: each override INSERTs a new row; the **current** override per field = latest by `(overridden_at DESC, id DESC)`. `GET .../extraction` returns the current override per field via `DISTINCT ON (field_name)`.

**`original_value` chains through prior overrides.** When the same field is overridden more than once, each row's `original_value` is the *previous* row's `override_value` — not the original extraction value — so the table is a faithful "what the reviewer saw before each change" trail rather than collapsing every override to "vs. the model". The handler reads the latest prior override for the `(document_id, field_name)` pair first; only if none exists does it fall back to `vendor_assurance_extractions.fields[field_name].value` (and a prior override implies the extraction exists, so the "no extraction" 409 only fires on a true first override with no extraction). The `vendor_assurance.field.overridden` audit payload carries this same chained `original_value`.

**Audit events** (via `writeAuditEvent`, resource_type `vendor_assurance_document`, resource_id = document id):

| Event type | When | Payload |
|---|---|---|
| `vendor_assurance.field.overridden` | `POST .../field-overrides` succeeds | `{ field_name, original_value, override_value, reason }` |
| `vendor_assurance.document.approved` | `POST .../approve` succeeds | `{}` |
| `vendor_assurance.document.manual_review_requested` | `POST .../request-manual-review` succeeds | `{ comment }` (comment may be `null`) |
| `vendor_assurance.document.rejected` | `POST .../reject` succeeds | `{ reason }` |

The legacy `vendor_assurance.document.uploaded`, `vendor_assurance.document.pdf_url_issued`, `vendor_assurance.review_decision.recorded`, and `vendor_assurance.document.finalized` events are unchanged.

---

## 4. Status state-machine — before / after

### Before (migration `20260610_vendor_assurance_documents.sql`)

```
pending ──► extracting ──► extracted ──► finalized            (terminal; sets finalized_at / finalized_by_user_id)
                       └─► extraction_failed                  (re-upload to retry)
```

- `processing_status` CHECK: `IN ('pending','extracting','extracted','extraction_failed','finalized')`
- `vendor_assurance_documents_finalized_consistency`: `(finalized_at IS NULL AND finalized_by_user_id IS NULL) OR (finalized_at IS NOT NULL AND processing_status = 'finalized')`
- Finalize precondition: every material field has a current review decision (`vendor_assurance_review_decisions`).

### After (migration `20260612_vendor_assurance_document_presentation.sql`)

```
pending ──► extracting ──► extracted ──┬─► approved                  (terminal-success; sets approved_at / approved_by_user_id)
                                       ├─► manual_review_requested   (NOT terminal — a future human-review action may move it back to
                                       │                              extracted or forward to approved/rejected; out of scope here)
                                       └─► rejected                  (terminal)
                       └─► extraction_failed                         (re-upload to retry)

(legacy)  finalized   — still a legal value; no new code path writes it; the old POST /finalize route remains for backward compat.
```

- `processing_status` CHECK (named `vendor_assurance_documents_processing_status_check`): `IN ('pending','extracting','extracted','extraction_failed','finalized','approved','manual_review_requested','rejected')` — widening only; no previously-legal value removed.
- New columns: `approved_at TIMESTAMPTZ NULL`, `approved_by_user_id UUID NULL REFERENCES users(id) ON DELETE SET NULL`.
- New constraint `vendor_assurance_documents_approved_consistency`: `(approved_at IS NULL AND approved_by_user_id IS NULL) OR (approved_at IS NOT NULL AND processing_status = 'approved')` — a parallel of the finalized-consistency CHECK.
- `vendor_assurance_documents_finalized_consistency` is **unchanged**.
- Transition routes: `approve` / `request-manual-review` / `reject` each require the document to be in `extracted` state (else 409), and the UPDATE re-asserts `processing_status = 'extracted'` so a lost race returns 409 rather than a double transition.

#### Override semantics differ by state

`POST .../field-overrides` is only meaningful on a document that still has a working extraction, and the post-`extracted` states are not all the same:

| State | Overrides allowed? | Notes |
|---|---|---|
| `extracted` | yes | the normal review state |
| `manual_review_requested` | **yes** | this is the state where a human reviewer is expected to correct fields, so it stays editable (not terminal) |
| `approved` | **no — 409** `vendor_assurance_document_not_overridable` (with `status` in the payload) | `approved` is the new terminal-success state and the version of record; correcting an approved document requires a future explicit "re-open" action (out of scope for this package — designed when there is signal for it) |
| `rejected` | **no — 409** | terminal |
| `finalized` (legacy) | **no — 409** | locked; no new code path produces this state anyway |

So the refusal set in `recordVendorAssuranceFieldOverride` is `{ 'approved', 'rejected', 'finalized' }`. (The 409 also fires with `vendor_assurance_extraction_missing` when there is no extraction and no prior override for the field.)

#### Why `approved_at` / `approved_by_user_id` instead of reusing `finalized_at` / `finalized_by_user_id`

The existing `vendor_assurance_documents_finalized_consistency` CHECK hard-codes `processing_status = 'finalized'`. Setting `finalized_at` while `processing_status = 'approved'` fails it; leaving `finalized_at` NULL for an approved doc loses the timestamp. Reuse would require altering that CHECK, which the package spec says must stay unchanged. A parallel pair of columns with their own consistency CHECK is the clean option. (The spec called `approved_by_user_id` NOT NULL; it is implemented nullable with `ON DELETE SET NULL` to match every other `*_by_user_id` column on these tables and to support API-key-only callers — a deliberate divergence, flagged below.)

#### Why the migration is dated `20260612`, not "today" (`20260512`)

`scripts/runMigrations.ts` applies un-applied migration files in **filename-sorted order**. This migration `ALTER`s `vendor_assurance_documents`, which is created by `20260610_…` and altered by `20260611_…`. A `20260512_…` file would sort before both — on a fresh database it would run first and fail. The file is therefore dated `20260612` to sit after `20260611`. (Flagged: the package spec said "dated today".)

---

## 5. Deferred enhancements

- **PDF span highlighting** — overlaying the extraction's source spans on the rendered PDF. Out of scope here; depends on same-origin PDF bytes (now in place). → Package 1.5.
- **`severity` and `remediation_plan` on exceptions** — these fields do not exist in the SOC extraction schema. Adding them requires a future extraction-schema package: bump `PROMPT_VERSION` (prompt v3), extend `MATERIAL_FIELDS`, update `socExtractionValidator.ts`. Explicitly forbidden in this package ("do not modify the SOC extraction prompt or validator").
- **CUEC matcher / suggestion queue** — mapping CUECs to the customer's own controls. → Package 2.
- **Excel / PDF export** of the reviewed document. → Package 3.
- **Legacy review-flow removal** — the `vendor_assurance_review_decisions` table, the `POST .../review-decisions` and `POST .../finalize` routes/handlers, and the `'finalized'` CHECK value all become dead once nothing reads them. Left in place here; removed in a dedicated cleanup package.
- **`approved_by_user_id` nullability** — implemented nullable + `ON DELETE SET NULL` rather than the spec's NOT NULL, to match the existing `uploaded_by_user_id` / `finalized_by_user_id` / `decided_by_user_id` convention and to allow API-key-only callers. If a hard "approver must be a known user" rule is wanted, that is a follow-up (it would also need the route to reject when `req.userId` is absent).
