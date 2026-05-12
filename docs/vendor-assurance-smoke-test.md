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
| Right panel — section 2 | "Complementary User Entity Controls" — bulleted list of CUEC statements (or "0 controls" empty state) | ☐ | |
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
