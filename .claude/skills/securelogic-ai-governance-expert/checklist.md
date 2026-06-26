# Checklist — AI Governance Expert

For any change in the AI-governance or compliance (framework/control/obligation) domains.

## Domain modeling (BLOCKING)
- [ ] Uses the canonical object (AI System / Governance Review / AI Governance Assessment /
      Framework / Requirement / Control / Control Assessment / Obligation / Obligation
      Assessment / Evidence) — no parallel concept, no free-text/JSON-blob storage.
- [ ] Respects the **mutable vs point-in-time** split and the correct `source_type`
      (`ai_review` vs `ai_governance_review`, `control_test`, `obligation_review`).
- [ ] Finding-on-first-transition wired for triggering statuses (`non_compliant` /
      `partially_compliant` / `flagged` / `needs_remediation` etc.), with correct `domain`.
- [ ] Enum values are canonical (criticality lowercase; severity PascalCase) — not re-declared.

## Tenancy & gating (BLOCKING)
- [ ] Every query org-scoped from `req.organizationContext`; new tables get
      `organization_id NOT NULL` + index + RLS policy (defer to **securelogic-security-reviewer**).
- [ ] Entitlement tier correct (vendor/AI/compliance surface is `premium`), cited from §9.

## Evidence & approvals
- [ ] Evidence stored as structured immutable records with `(source_type, source_id)` linkage;
      blobs via R2 `org/{orgId}/…`.
- [ ] Approvals/sign-off attached to the workflow record + `writeAuditEvent` (actor + reason),
      not prose.

## Frameworks / crosswalks (HONESTY)
- [ ] External-framework relationships sourced from `frameworks/crosswalk*.json`, not a
      hardcoded divergent mapping.
- [ ] Claims about framework coverage are labeled: category-crosswalk/stub (VERIFIED) vs full
      assessable catalog (NOT proven). No overstating NIST AI RMF / ISO 42001 / SOC 2 depth.
- [ ] ISO 27001 vs ISO 42001 reconciled before any output claims ISO 27001.
- [ ] New per-standard catalog / readiness automation labeled **RECOMMENDED** if not built.

## Scoring
- [ ] Posture/readiness impact understood: findings flow to the pure V2 engine; `domain`
      rollup correct; overall NULL on zero findings.
- [ ] Read `frameworkReadiness.ts` before changing readiness logic — don't assume a model.

## Validation
- [ ] Unit tests for workflow transitions + finding creation + validators (mocked `pg`).
- [ ] Cross-org isolation test if a new customer-data table/surface is added.
- [ ] `CANONICAL_DOMAIN_MODEL.md` row updated for any new canonical object/enum.
