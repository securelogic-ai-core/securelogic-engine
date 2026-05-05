# Industry-starter-templates — design decisions

This document captures decisions taken during Package 5 that are intentional
and not bugs. Reviewers should read this before "fixing" any of the following.

## v1 ships dark in production

**This is the most important framing for whoever flips the switch.**

All three v1 templates carry `needs_review:true` on at least one entry
(healthcare-saas: 5, fintech: 2, b2b-ai: 2). The single env-var gate
`SECURELOGIC_INDUSTRY_TEMPLATES_ENABLED` is **default-off in production**.
Until a domain expert reviews the flagged entries and the env var is
explicitly set to `"true"`, the /templates page returns 404 and the
dashboard banner does not render in production.

This is **deliberate**: better to ship the rails dark and light them up
after review than to ship hot and pull back. The cost of a customer
loading a template containing a flagged-uncertain regulatory obligation
(e.g. EU AI Act high-risk obligations, deferral status uncertain) is
real — they may key compliance work to an obligation that gets re-scoped
between v1 and the post-review pass.

**To turn templates on in production**: set
`SECURELOGIC_INDUSTRY_TEMPLATES_ENABLED=true` in the production
environment after the domain expert has cleared the `needs_review:true`
entries for at least one template. The gate is **all-or-nothing** —
flipping it on exposes all three templates simultaneously. Per-template
gating is a future refinement.

## The eight product decisions

1. **Three industries**, no fourth in this package: healthcare-saas,
   fintech, b2b-ai.
2. **Additive loading**, dedup via `ON CONFLICT DO NOTHING`. Dedup keys
   are the actual table UNIQUEs, NOT the spec-proposed
   `(org, framework_id, control_name)` etc. — see "Schema mapping"
   below for the gap and the resolution.
3. **Loaded rows are normal tenant data** — fully editable, deletable,
   indistinguishable from manually-entered rows except for
   `template_source` (analytics-only, indexed partial WHERE NOT NULL).
4. **Two surfaces**: /templates page (always) + dashboard banner (first
   7 days post-user-creation, dismissible, persists in
   `users.dismissed_banner_keys`).
5. **Preview before commit** — full-content preview, per-row checkboxes,
   default all checked, confirm shows live counts. Selection state is
   in component state (not URL — see "Why selection isn't in the URL"
   below).
6. **Storage as TypeScript modules** — under `src/templates/` (the
   spec said `data/templates/`, but the engine's tsconfig rootDir
   is `src/`, so templates live under src to be typechecked. Operationally
   identical; rename if rootDir loosens later).
7. **Dense set** (~30-40 controls per template), not a curated subset.
8. **needs_review** boolean on uncertain entries; binary env-var gate
   (above).

## Schema mapping — where the loader bridges spec ↔ schema

The spec's notional dedup keys did not match the actual schema in three
places. The resolutions, all decided in the investigation:

- **`controls.framework_id` does not exist.** Framework relationship is
  via `control_mappings → requirements → frameworks`. The loader
  upserts a `frameworks` row per (org, framework_ref), creates ONE
  synthetic `requirements` row per (framework, template) with
  `reference_id = 'industry-template:{industryId}'` and `title =
  '{Template Name} template baseline'`, and writes a `control_mappings`
  row for each newly-inserted control. **Pre-existing controls (skipped
  via ON CONFLICT) get NO new control_mapping** — by design. The mapping
  is part of the load event; manually-created controls should not be
  retroactively framework-tagged.
- **`obligations.regulation_name` is actually `obligations.title`**, and
  the UNIQUE is `(organization_id, title)` — jurisdiction not in the
  unique. Templates with the same regulation in different jurisdictions
  (rare in practice) will conflict on second load. GDPR appears in both
  fintech and b2b-ai → second load skips. Intended.
- **`vendors` has no per-vendor flag columns**. The curation's
  `processes_phi`, `baa_required`, `processes_pii`,
  `processes_payment_data`, `processes_ai_inference` flags ride in a new
  `vendors.template_metadata JSONB` column under
  `{ flags: { ... } }`. Sub-key keeps room for future template-time
  metadata without further schema changes. If a flag becomes a hot-path
  query (e.g. "list all PHI vendors"), promote to a column then with a
  one-shot backfill.

## ai_systems is empty in v1

All three v1 templates have `ai_systems: []`. The b2b-ai template's
foundation model providers (OpenAI, Anthropic, etc.) are listed as
**vendors**, not ai_systems — the latter represent the customer's OWN
AI features (their LLM applications, their AI agents), which the
customer enters manually after template load.

The `TemplateAiSystem` TS type and the loader branch are wired so a
future template can populate ai_systems without code changes. Loader
return shape always includes `ai_systems: 0/0` in v1.

## Why selection isn't in the URL

The first draft put preview-page checkbox state in URL params for
shareability. Two reasons we backed out:

- ~100 items per template means encoding a deselected-set is the
  compact form (default-checked), but even that hits URL length limits
  on some browsers when most items are toggled.
- Sharing a checkbox state assumes someone else can act on your inventory
  — they cannot, the loader is org-scoped to the requesting user's session.

If shareability becomes a real ask (e.g. "send this template config to my
auditor"), a compact bitset encoding plus a server-side share-link table
is the right primitive. v1 keeps it simple.

## Synthetic-requirement title uses the template name

When two templates share a framework (e.g. healthcare-saas and fintech
both reference NIST CSF 2.0), each creates its own synthetic requirement
under that framework, with the template name in the title. This makes
the framework-readiness report readable:

> NIST CSF 2.0
>   - Healthcare SaaS template baseline (38 controls)
>   - Financial Services Fintech template baseline (16 controls)

without one displacing the other. The trade-off: a framework can have
multiple "baseline" requirements over time as additional templates load.
Acceptable; the readiness report sorts by reference_id which clusters
them logically.

## Curation notes encoded verbatim

- **Sardine** (fintech): listed in both KYC/AML and Fraud sections of the
  appendix. Encoded once under KYC/AML with combined description per the
  appendix's dedup instruction.
- **Synapse** (fintech): historical reference retained with
  `needs_review:true`. Filed bankruptcy 2024; kept for due-diligence
  questionnaire response.
- **MFA control + 72h restoration target** (healthcare-saas): the
  appendix attached a note — "Mandatory under proposed 2025 rule
  update" / "Restoration target from proposed 2025 rule". The note is
  in the description and the entry carries `needs_review:true`.
- **HIPAA Security Rule, Washington MHMD, PIPEDA, EU AI Act high-risk,
  Colorado AI Act, multi-state NMLS**: all flagged in the appendix as
  uncertain (regulatory flux, Digital Omnibus negotiation, jurisdiction
  ambiguity). All carry `needs_review:true`.

## Curation count discrepancies (flagged to operator)

The appendix headers list counts that don't match the enumerated content:

| Template          | Header says   | Actual content |
|-------------------|---------------|----------------|
| healthcare-saas   | 28 vendors    | 29 vendors     |
| healthcare-saas   | 14 obligations| 14 obligations |
| healthcare-saas   | 38 controls   | 38 controls    |
| fintech           | 32 vendors    | 39 vendors     |
| fintech           | 16 obligations| 16 obligations |
| fintech           | 42 controls   | 41 controls    |
| b2b-ai            | 24 vendors    | 34 vendors     |
| b2b-ai            | 13 obligations| 13 obligations |
| b2b-ai            | 35 controls   | 36 controls    |

Templates were encoded against the **enumerated content**, not the
header counts. If the operator wants to drop entries to match the
header counts, name which entries to drop in a follow-up.

## Cross-template vendor variance

Some vendors appear in multiple templates with different criticality
values (e.g. Twilio: high in healthcare-saas, medium in fintech).
`ON CONFLICT DO NOTHING` means the **first template loaded** sets the
criticality; later loads keep first-load values. This matches the
"additive, never overwrites" decision (#2). Customer can always edit
after the fact.

## What this package does NOT include

- Customer-defined templates ("save my inventory as a template").
- Per-row "this came from template X" UI surface (analytics-only via
  `template_source` column, no UI yet).
- International template variants (EU healthcare, EU fintech).
- More than three industries (explicit scope cap).
- Loading templates programmatically via API for non-customers
  (tenant-scoped only; no admin-cross-org load).
- Frontend automated tests (per Package 4 precedent). See
  `docs/templates-smoke-test.md` for the manual checklist.
