# Vendor-Assurance Document Presentation — staging smoke test

**Package:** `vendor-assurance-document-presentation`
**Environment:** `securelogic-engine-staging` + `securelogic-app-staging` only.
**Preconditions:** migration `20260612_vendor_assurance_document_presentation.sql` applied on staging; `SECURELOGIC_VENDOR_ASSURANCE_ENABLED=true` on the staging engine; `R2_*` populated; `react-pdf` present in the deployed app bundle and `app/public/pdf.worker.min.mjs` at the version `app/package-lock.json` pins (a worker/version mismatch surfaces as "The API version … does not match the Worker version …" in the browser console).

Walk this end-to-end on staging and tick each box. Append notes; do not rewrite.

---

## 1. Upload → extraction

| Step | Expected | OK | Notes |
|---|---|---|---|
| Upload a text-bearing SOC PDF from a vendor detail page | redirects to `/vendor-assurance/<documentId>`; document row created `processing_status = pending` | ☐ | |
| Refresh after a few seconds | `processing_status` advances to `extracting` then `extracted` | ☐ | |

## 2. Document page renders

| Step | Expected | OK | Notes |
|---|---|---|---|
| Open `/vendor-assurance/<documentId>` | sticky header shows filename, vendor link, an "Awaiting review" chip, and Approve / Request Manual Review / Reject Extraction buttons | ☐ | |
| Left panel | source PDF renders with react-pdf; page count shown; ‹ Prev / Next › navigate; on desktop the panel sticks while the right column scrolls | ☐ | |
| Right panel — section 1 | "Cover Sheet" with human-readable labels (Vendor name, Report type, …, Controls), one row per field, confidence chips on extracted values | ☐ | |
| Right panel — section 2 | "Complementary User Entity Controls" — one card per CUEC with its inventory-mapping status + a Re-match button (see §7), and beneath it the raw extracted `cuecs` list with the override affordance | ☐ | |
| Right panel — section 3 | "Exceptions and Deviations" — one card per exception (Control id, description, Auditor assessment), management responses joined by `exception_ref`; "No exceptions or deviations were noted" when the array is empty | ☐ | |
| Mobile width | PDF stacks above the three sections | ☐ | |

## 3. PDF proxy

| Step | Expected | OK | Notes |
|---|---|---|---|
| Network tab while the PDF loads | request goes to `/api/vendor-assurance/<documentId>/pdf` (same origin), `200`, `Content-Type: application/pdf` — **no** request to the R2 host, **no** 302 visible to the browser | ☐ | |
| Hit `/api/vendor-assurance/<documentId>/pdf` while logged out | `401` | ☐ | |
| Hit `/api/vendor-assurance/<bad-uuid>/pdf` while logged in | `404` (engine rejects the uuid → proxy returns 404) | ☐ | |

## 4. Field override

| Step | Expected | OK | Notes |
|---|---|---|---|
| Click "Edit" on a Cover Sheet scalar field, leave the reason blank, Save | inline error "A reason is required…"; nothing persisted | ☐ | |
| Enter a replacement value + a reason, Save | modal closes; page re-renders; the field now shows the override value and an "Overridden" badge; hovering the badge shows original + reason + reviewer + timestamp | ☐ | |
| Click "Edit" on a structured field (e.g. Trust Services Criteria), supply invalid JSON, Save | inline error "the replacement must be valid JSON" | ☐ | |
| Re-`GET .../extraction` (or refresh) | `field_overrides` array contains the latest override per field | ☐ | |
| `security_audit_log` | a `vendor_assurance.field.overridden` row with `resource_id` = document id and payload `{ field_name, original_value, override_value, reason }` | ☐ | |

## 5. Document-level transitions

| Step | Expected | OK | Notes |
|---|---|---|---|
| Click "Request Manual Review", add an optional note, submit | status → `manual_review_requested`; header replaced with a "Manual review requested" chip; action buttons gone; `vendor_assurance.document.manual_review_requested` audit row with `{ comment }` | ☐ | |
| (On a second extracted document) Click "Reject Extraction" with a blank reason | inline error; nothing persisted | ☐ | |
| Submit "Reject Extraction" with a reason | status → `rejected`; "Extraction rejected" chip; Edit affordances on fields disappear (`canEdit` false); `vendor_assurance.document.rejected` audit row with `{ reason }` | ☐ | |
| (On a third extracted document) Click "Approve" | status → `approved`; `approved_at` / `approved_by_user_id` set; "Approved · <date>" chip; `vendor_assurance.document.approved` audit row | ☐ | |
| Try to override a field on the approved document | `409 vendor_assurance_document_not_overridable` (approved is locked / the version of record); Edit affordances on fields are gone (`canEdit` false) | ☐ | |
| Re-POST `.../approve` on the approved document | `409 vendor_assurance_document_not_extracted` | ☐ | |
| Override a field while the document is in `manual_review_requested` | succeeds (this state stays editable for human reviewers) | ☐ | |
| Cross-org: GET `.../extraction`, POST `.../approve`, POST `.../field-overrides`, GET `.../pdf` for another org's document | every one `404` | ☐ | |

## 6. Queue page

| Step | Expected | OK | Notes |
|---|---|---|---|
| `/vendor-assurance/queue` | status filter chips include Manual review requested / Approved / Rejected; the documents above appear under the right statuses | ☐ | |

---

## 7. CUEC matcher (`vendor-assurance-cuec-matcher` package)

**Preconditions:** the org has at least a few `controls` (with `status = 'active'`) in its inventory; `ANTHROPIC_API_KEY` set on the staging engine (the matcher makes an LLM call); migration `20260613_vendor_assurance_cuecs.sql` applied; for existing test documents, `scripts/backfill-vendor-assurance-cuecs.ts` run once on staging (`DATABASE_URL='...staging...' ANTHROPIC_API_KEY='...' npx tsx scripts/backfill-vendor-assurance-cuecs.ts`).

| Step | Expected | OK | Notes |
|---|---|---|---|
| Upload a SOC report with CUECs; wait for extraction to finish | the document detail page's "Complementary User Entity Controls" section now shows one card per CUEC (not a flat string list); the section header has a "Re-match against inventory" button and an "N CUECs · M mapped · K need review" summary | ☐ | |
| Check `security_audit_log` / engine logs after extraction | a `cuec_matcher_complete` log line (or `cuec_matcher_llm_unavailable_or_failed` if no key); `vendor_assurance_cuecs` rows exist for the document; `vendor_assurance_cuec_control_mappings` rows with `mapping_status='suggested'`, `mapping_source='auto'` for the matches above score 60 | ☐ | |
| On a CUEC with a suggested match: click **Accept** | the suggested card collapses; the control appears as a green chip ("Mapped to your control"); the mapping row is `mapping_status='accepted'`; audit row `vendor_assurance.cuec_mapping.updated` with `from:'suggested', to:'accepted'` | ☐ | |
| On a CUEC with a suggested match: click **Dismiss**, leave the reason blank → submit | inline error "A reason is required"; nothing persisted | ☐ | |
| Submit Dismiss with a reason | the suggestion disappears (shows under "dismissed" disclosure); mapping row is `mapping_status='dismissed'` with the reason; audit `vendor_assurance.cuec_mapping.updated` `from:'suggested', to:'dismissed'` with the reason | ☐ | |
| On a CUEC: type in the **ControlPicker** ("Search your inventory…") and pick a control | a manual `mapping_status='accepted'`, `mapping_source='manual'` row is created; the control appears as a chip; audit `vendor_assurance.cuec_mapping.created` | ☐ | |
| On a CUEC with no good match: click **Mark as no applicable control**, optionally add a reason → confirm | the CUEC shows "No applicable control in your inventory" (reason on hover); `vendor_assurance_cuecs.review_status='reviewed_no_match'`; audit `vendor_assurance.cuec.review_status_updated`; the summary count moves to "no applicable control" | ☐ | |
| On that CUEC: click **Undo** | back to `review_status='pending'`; suggestions/ControlPicker reappear; `review_status_reason`/`_updated_at` cleared | ☐ | |
| Click the section's **Re-match against inventory** button | the matcher re-runs; previously **accepted** and **dismissed** mappings and any `reviewed_no_match` state are preserved; `suggested` rows are replaced from the fresh run; previously-dismissed `(cuec, control)` pairs are NOT re-suggested; audit `vendor_assurance.cuecs.rematched` with the run summary | ☐ | |
| Add a new active control to the inventory, then Re-match | the new control can now appear as a suggestion on a relevant CUEC | ☐ | |
| Override the `cuecs` field (the "Underlying extracted CUEC list" → Edit) with a different list + reason | the CUEC cards rebuild from the new list; all prior CUEC mapping state for the document is reset (the list changed); a fresh re-match runs in the background | ☐ | |
| Approve the document, then revisit the CUEC section | CUEC mapping is still fully editable (Accept/Dismiss/Add/Mark-no-match all work) — only the `cuecs` field *override* (and the other field overrides) is locked, not the mapping workflow | ☐ | |
| Cross-org: `GET /api/vendor-assurance/documents/<other-org-doc>/cuecs`, `PATCH /api/vendor-assurance/cuec-mappings/<other-org-mapping>`, `POST /api/vendor-assurance/cuecs/<other-org-cuec>/review-status` | every one `404` | ☐ | |
| `GET /api/controls?q=<text>` (authenticated) | returns controls whose name/description match, ordered by name; the ControlPicker type-ahead uses this | ☐ | |
