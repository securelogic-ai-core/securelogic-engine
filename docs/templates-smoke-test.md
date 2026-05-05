# Industry-starter-templates — manual smoke test

No automated frontend tests for this package (matching Package 4
precedent). Walk this checklist on staging before promoting `develop` →
`main`.

## Pre-conditions

- `SECURELOGIC_INDUSTRY_TEMPLATES_ENABLED=true` set in the staging
  environment, OR `NODE_ENV=development` (the gate is permissive in
  non-production).
- Logged in as a platform-tier user, fresh org with no inventory.

## 1. Gate behavior

- [ ] With env var unset and `NODE_ENV=production`, GET /templates
      returns 404 in the network tab.
- [ ] With env var unset and `NODE_ENV=production`, the dashboard does
      NOT render the templates banner.
- [ ] Set `SECURELOGIC_INDUSTRY_TEMPLATES_ENABLED=true`. /templates loads
      the index page, banner appears on /dashboard for new users.

## 2. Templates index

- [ ] /templates renders three cards: Healthcare SaaS, Financial
      Services Fintech, B2B AI Tooling.
- [ ] Each card shows counts (vendors / obligations / controls) and a
      "Some entries flagged for review" badge (all three have
      needs_review entries in v1).
- [ ] Clicking a card navigates to /templates/{industry}.

## 3. Preview page — healthcare-saas

- [ ] All vendors / obligations / controls render with checkboxes
      default-checked.
- [ ] Confirm bar at bottom reads "Load 29 vendors, 14 obligations, 38
      controls into your inventory."
- [ ] Items flagged `needs_review:true` show a small `review` badge:
      HIPAA Security Rule, Washington MHMD, PIPEDA, MFA control,
      72-hour restoration control.
- [ ] "Deselect all" on Vendors zeros the vendor count, leaves
      obligations and controls counts unchanged.
- [ ] "Select all" on Vendors restores.

## 4. Load flow

- [ ] Click Confirm. Network tab shows POST /api/templates/load with
      `industry_id: "healthcare-saas"` and `selected_item_ids: [...]`.
- [ ] Response: `{ industry_id, inserted: { vendors:29, ... },
      skipped: { ... } }`.
- [ ] Page redirects to /vendors?templates_loaded=1.
- [ ] /vendors lists the new vendors. /obligations lists the obligations.
      /controls lists the controls.
- [ ] Open any vendor row in the DB; `template_source = 'healthcare-saas'`.
      Vendors with flags have `template_metadata` with
      `{ flags: { processes_phi: true, ... } }`.

## 5. Dedup on second load

- [ ] Visit /templates/healthcare-saas again, confirm again.
- [ ] Response: `inserted: { vendors:0, ai_systems:0, obligations:0,
      controls:0 }`, `skipped: { vendors:29, obligations:14,
      controls:38 }`.
- [ ] No new control_mappings rows (verify in DB or via
      framework readiness report — count unchanged).

## 6. Selective load

- [ ] Fresh org. /templates/fintech, deselect 5 vendors, leave the rest.
      Confirm.
- [ ] Response inserted.vendors === 34 (39 - 5).
- [ ] Re-visit /vendors; the 5 deselected names are absent.

## 7. Cross-org isolation

- [ ] User A loads healthcare-saas in org A.
- [ ] User B in org B visits /vendors — sees nothing from the load.
- [ ] User B loads healthcare-saas in org B; both orgs now have their
      own copies (no shared rows).

## 8. Framework readiness shows the synthetic requirement

- [ ] After loading healthcare-saas, /frameworks shows "NIST
      Cybersecurity Framework 2.0" listed.
- [ ] Drilling into the framework readiness report shows a single
      requirement titled "Healthcare SaaS template baseline" with all
      38 template controls mapped under it.

## 9. Banner — first 7 days

- [ ] Sign up a fresh user. Visit /dashboard.
- [ ] Banner "Get started faster — load an industry template" renders
      above the onboarding banner.
- [ ] Click the × button. Banner disappears, page reloads, banner
      stays gone.
- [ ] Open `users.dismissed_banner_keys` for that user — contains
      `'industry-templates-banner'`.
- [ ] Verify in DB: simulate a user older than 7 days
      (`UPDATE users SET created_at = NOW() - INTERVAL '8 days' WHERE
      id = ...`). Reload /dashboard — banner does NOT render even if
      not dismissed.

## 10. Audit log

- [ ] After a load, `security_audit_log` has a row with
      `event_type='industry_template.loaded'`,
      `resource_type='industry_template'`, `resource_id IS NULL`,
      `payload->>'industry_id'='healthcare-saas'`,
      `payload->>'inserted_count' = '81'` for the full healthcare load.

## 11. Rollback on partial failure

(Cannot easily simulate in staging — covered by backend unit tests
`templateLoader.test.ts:"a vendor INSERT failure rolls back and
re-throws; no audit event written"`.)

## Pre-deploy gate

- [ ] All sections above passed.
- [ ] No console errors during any flow.
- [ ] Domain expert review pass on `needs_review:true` entries
      completed before `SECURELOGIC_INDUSTRY_TEMPLATES_ENABLED=true`
      is set in production. (Templates remain dark in production until
      this gate is satisfied.)
