# Risk Register State Verification (RR-0)

**Date:** 2026-05-06
**Companion document:** RISK_REGISTER_ROADMAP.md
**Purpose:** Answer the three honest unknowns flagged in RISK_REGISTER_STATE.md so downstream package scoping proceeds on confirmed ground.

---

## Question 1: Findings linkage in UI

**Findings: PARTIAL — the inverse direction (findings linking back to risks) is fully wired; the forward direction (risk's own `source_type`/`source_id` recording where the risk originated) is NOT surfaced in the UI.**

### What exists

A "Linked Findings" section is rendered on the risk detail page at `app/src/app/risks/[id]/RiskDetailClient.tsx:355-398`. The data is fetched in `app/src/app/risks/[id]/page.tsx:38` via:

```
getFindings(token, { source_type: "risk", source_id: id, status: "open", limit: 50 })
```

The query traverses the `findings` table where `findings.source_type = 'risk'` and `findings.source_id = risk.id`. It returns up to 50 open findings linked to this risk. Each finding renders as a row with a severity pill (color-mapped via the customer scale) and the finding title as a clickable link to `/findings/{id}`. A "View all →" link routes to `/findings?source_type=risk&source_id={id}` for the full filtered list.

The risk table row also surfaces a finding count badge — the join is computed server-side in `GET /api/risks/intelligence` at `src/api/routes/risks.ts:611-649`, which `LEFT JOIN findings ON f.source_type='risk' AND f.source_id=r.id AND f.status='open'` and exposes `linked_findings` as a count. The count is merged into the table row at `app/src/app/risks/page.tsx:138-166` and rendered via `app/src/components/risks/RiskRow.tsx:120-123`.

### What does NOT exist

The `risks` table's own `source_type` and `source_id` columns are present in the API select (`src/api/routes/risks.ts:153-176`) and typed on the `Risk` interface (`app/src/lib/api.ts:556-557`), but **no UI component reads `risk.source_type` or `risk.source_id`**. The metadata grid in `RiskDetailClient.tsx:112-119` shows Owner, Domain, Status, Due Date, Created, Last Updated — and nothing else from those origin columns. A grep across `app/src/` confirms zero references.

The risk-side `source_type` is also not enum-validated (`src/api/lib/riskValidation.ts:330-373` enforces co-presence with `source_id` and "non-empty string" only — no VALID_SOURCE_TYPES set restricts the value). So the column can hold arbitrary strings; the docstring at `src/api/routes/risks.ts:182-188` says it can reference "findings, assessments, signals, or manual entries."

For comparison, the `findings` table validates `source_type` against an enum at `src/api/routes/findingsExport.ts:23-26`: `vendor_review`, `control_test`, `obligation_review`, `ai_review`, `ai_governance_review`, `manual`, `assessment`, `signal`, `risk`. The risk-side soft reference doesn't have an equivalent constraint.

### Implications for RR-1

The roadmap's RR-1 description says "If basic UI exists: Extend it to handle multiple findings per risk if not already supported, and surface the link inline on the risk table row." Both of those already exist:

- Multiple findings per risk: yes (50-row limit, list renders fine)
- Inline badge on risk table row: yes (via `linked_findings` count from `/api/risks/intelligence`)

The remaining gap is the forward direction — surfacing the risk's own provenance (`risk.source_type` / `risk.source_id`) on the detail page. That's small additional UI work, not the bulk of RR-1.

**RR-1 effort shrinks. Most of the original scope already exists.** Reframe the package as "Surface risk's own origin metadata + minor finding-section polish."

---

## Question 2: Risks write to security_audit_log

**Findings: PARTIAL — risk creates and updates write audit events with structured before/after payloads. Treatment status transitions write audit events. Treatment creation does NOT. No DELETE handlers exist for either resource.**

### Audit infrastructure

The `writeAuditEvent()` helper at `src/api/lib/auditLog.ts:54` is fire-and-forget — never throws, never blocks the request path, writes to `security_audit_log` in the background. Payload shape (lines 29-46): `organizationId`, `actorApiKeyId`, `actorUserId`, `eventType` (dot-notation: `domain.action`), `resourceType`, `resourceId`, `payload` (JSON, < 1KB), `ipAddress`. The infrastructure is mature — used by 14+ route files.

### What writes audit events

| Operation | Route | Event Type | Resource Type | Payload | Source |
|-----------|-------|-----------|---------------|---------|--------|
| Risk create | POST /api/risks | `risk.created` | `risk` | `{domain, risk_rating, inherent_rating: {before:null, after}, residual_rating: {before:null, after}, status}` | risks.ts:295-310 |
| Risk update | PATCH /api/risks/:id | `risk.updated` | `risk` | `{fields: [changed_keys], inherent_rating: {before, after} \| undefined, residual_rating: {before, after} \| undefined}` | risks.ts:871-890 |
| Treatment status transition | PATCH /api/risk-treatments/:id | `workflow.status_transition` | `risk_treatment` | `{from: prev_status, to: new_status, riskUpdated: bool}` | riskTreatments.ts:538-547 |

### What does NOT write audit events

- **POST /api/risk-treatments** (treatment creation, riskTreatments.ts:95) — only emits `logger.info({event: "risk_treatment_created"})` at lines 174-183. No `writeAuditEvent` call. Gap.
- **DELETE /api/risks/:id** — does not exist. The risks router at `src/api/routes/risks.ts` has POST, GET (4 variants), PATCH only. No `router.delete` anywhere.
- **DELETE /api/risk-treatments/:id** — does not exist. Same pattern: POST, GET (2 variants), PATCH only.
- **Treatment non-status updates** — the PATCH handler at riskTreatments.ts:384 is structured around status transitions (`isValidTransition` check at line 451). It does support updating other fields (summary, notes, owner, due_date, performed_at, reviewer_id at lines 458-505) but only as part of a status transition. There is no separate "edit metadata without changing status" path. The audit event covers status transitions, but if non-status fields are updated alongside a transition, only the status transition is logged in the payload — the field-level changes are not captured.

### Other observations

- The PATCH handler on risks does NOT capture before/after for non-rating fields (title, description, domain, treatment text, owner, due_date, status). The payload only lists which fields were changed (`fields: Object.keys(input)`) and only inherent_rating/residual_rating get explicit before/after.
- The audit log table has its own GET endpoints at `src/api/routes/auditLog.ts` (list, single resource history, CSV export). UI surfacing of the audit trail on the risk detail page does NOT exist.

### Implications for RR-3

Backend audit logging is mostly in place for the existing surface area. Three gaps:

1. POST /api/risk-treatments needs a `writeAuditEvent` call (one-line addition).
2. Per-risk audit trail UI on the detail page does not exist — needs to be built (read from `/api/audit-log` filtered by `resource_type=risk` and `resource_id=this risk` plus joined treatment events).
3. Before/after payloads for non-rating field changes on risks are absent — auditors looking at "what was the description before this update" can't answer that from the current payload. Either accept this as a deliberate scope limit or extend the PATCH handler.

If the package treats (3) as out-of-scope (audit shows "fields changed: [description]" without before/after), **RR-3 effort shrinks to S** — it's mostly building the History UI section on the risk detail page plus the one-line treatment-create fix.

If the package treats (3) as in-scope, RR-3 stays at S–M.

The roadmap's "If RR-0 confirms audit logging already exists for risks, this package shrinks to 'surface the existing trail in the UI'" applies — that's the dominant remaining work.

---

## Question 3: Structured exports beyond CSV

**Findings: NO — the risk register has no dedicated export endpoint at all (CSV or PDF). Risk count summaries appear in the executive PDF report; the full register does not.**

### What exists for exports across the platform

- **CSV exports** — three endpoints follow a consistent pattern (RFC 4180 cell escaping, `Content-Type: text/csv`, audit-logged):
  - `GET /api/findings/export.csv` (`src/api/routes/findingsExport.ts`)
  - `GET /api/vendors/export.csv` (`src/api/routes/vendors.ts:417`)
  - `GET /api/audit-log/export.csv` (`src/api/routes/auditLog.ts:188`)
  - Frontend proxies live at `app/src/app/api/export/{findings,vendors,audit-log}/route.ts` (auth bridge)

- **PDF exports** — three endpoints, all using `pdfkit` (installed in `package.json`):
  - `GET /api/reports/executive.pdf` (`src/api/routes/executiveReport.ts:780`) — one-page-per-section summary covering posture score, risk breakdown, framework compliance, open findings
  - `GET /api/frameworks/:id/audit-package.pdf` (`src/api/routes/auditPackage.ts:400`) — framework-keyed, no risk content
  - `GET /api/frameworks/:id/gap-report.pdf` (gap-report route) — framework-keyed, no risk content
  - Frontend proxies at `app/src/app/api/export/{executive-report,audit-package,gap-report}/route.ts`

### Risk register-specific exports

**None.** The `/risks` page header (`app/src/app/risks/page.tsx:194-232`) has two action buttons: "↑ Import CSV" and "+ Add Risk". No export button. There is no `/api/risks/export.csv`, no `/api/risks/export.pdf`, no `/risks/export` UI route, no proxy under `app/src/app/api/export/risks/`.

### What the executive PDF does include

`src/api/routes/executiveReport.ts:147-167` queries open risks grouped by `residual_rating` and by `inherent_rating` and renders a count table (lines 468-521). This is summary-only — counts per Critical/High/Moderate/Low — not a row-by-row register dump. There is no export of treatment status, owner, due date, audit history, or acceptance metadata.

### Other reporting infrastructure

- `src/reporting/ReportExporter.ts` is a tiny class (19 lines) that writes JSON-format audit-sprint reports to disk. Not used by the API.
- `src/reporting/AuditSprintExporter.ts` exists but is not wired into route handlers (search for it returned no router-side imports in `src/api/routes/`).
- No NIST RMF, ISO 27005, or COSO ERM-formatted output of any kind for risks.
- No board-deck or executive-summary export specific to the risk register.

### Implications for RR-9

The PDF library (`pdfkit`) is installed and the pattern is established (`executiveReport.ts` is a working reference for layout, color palette, multi-page sections). A new `/api/risks/export.pdf` endpoint can be modeled on it — header / open risk count summary / row table / treatment status section / acceptance metadata section.

The CSV pattern is also well-established (three reference implementations) and is the smaller piece of the package.

Framework-formatted exports (NIST RMF / ISO 27005 / COSO ERM) are net-new — no precedent in the codebase.

**RR-9 effort estimate stays M to L** — the "extend existing export with three new formats" path the roadmap considered does not apply; this is "build new export endpoints following the existing pattern." The PDF infrastructure makes the per-format effort smaller than building from scratch, but each framework-formatted output is its own work.

---

## Summary of implications for downstream packages

- **RR-1: shrink significantly.** The "Linked Findings" UI section, the table-row count badge, and the multi-finding support all already exist. The only remaining piece is surfacing the risk's own `source_type`/`source_id` (the forward-direction provenance). Reframe RR-1 as "surface risk origin metadata; minor finding-section polish." Effort drops from S to XS.

- **RR-3: shrink to "build the History UI."** Backend audit logging for risk creates, updates, and treatment status transitions is already in place with structured payloads. Three small gaps: (a) POST /api/risk-treatments doesn't audit-log (one-line fix), (b) no DELETE handlers exist for either risks or treatments, (c) before/after for non-rating field changes is not captured. If (c) is accepted as a deliberate limit, RR-3 stays at S — dominated by the History UI section on the risk detail page reading from `/api/audit-log`.

- **RR-9: no change in effort estimate; reframe scope.** No risk-register export exists. The "extend existing export" path the roadmap contemplated does not apply. Build pattern is well-established (pdfkit + 3 reference CSV implementations + 3 reference PDF implementations), so per-format work is bounded, but each framework-formatted output (NIST RMF / ISO 27005 / COSO ERM) is net-new. Stays M to L.
