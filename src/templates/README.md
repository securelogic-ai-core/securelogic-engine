# Industry-starter templates

Static, code-shipped curation. Each industry file populates a `Template`
structure that the loader reads at request time
(`src/api/lib/templateLoader.ts`).

## Files

| File                  | Purpose                                              |
|-----------------------|------------------------------------------------------|
| `types.ts`            | Shared TS types: `Template`, `TemplateVendor`, etc. |
| `index.ts`            | Registry: `TEMPLATES`, `ALL_INDUSTRIES`, `FRAMEWORK_REFS`. |
| `healthcare-saas.ts`  | Healthcare SaaS template content.                    |
| `fintech.ts`          | Financial Services Fintech template content.         |
| `b2b-ai.ts`           | B2B AI Tooling template content.                     |

## Adding a new industry

1. Add the new `IndustryId` literal to the union in `types.ts`. The
   compiler will then complain about every `Record<IndustryId, ...>`
   that hasn't been updated — work through the errors.
2. Create `{industry}.ts` exporting a `Template` constant.
3. Register it in `index.ts` under `TEMPLATES` and `ALL_INDUSTRIES`.
4. If the new industry references a framework not in `FRAMEWORK_REFS`,
   add it to BOTH the `FrameworkRef` union (types.ts) and the
   `FRAMEWORK_REFS` map (index.ts). The compiler enforces both.

This is the only schema change needed — no migration. The tables use
the already-shipped `template_source` and (for vendors)
`template_metadata` columns added in
`db/migrations/20260505_template_source_columns.sql`.

## Content review process

1. Walk every entry against the current state of the regulation /
   standard / vendor.
2. Mark `needs_review: true` on entries you are uncertain about
   (regulatory flux, ambiguous coverage, draft-rule references,
   historical references retained for posterity).
3. Update `last_reviewed_at` to the date of the review pass — even if
   zero entries changed (the date is independent of `version`).
4. Bump `version` if any entry's content changed.

## needs_review semantics

- The flag is **not** loaded into the destination tables. It exists
  only on the curation side.
- The presence of any `needs_review:true` entry on a template makes
  the template **review-blocked**, surfaced in the /templates list as
  a "Some entries flagged for review" badge.
- The env-var gate `SECURELOGIC_INDUSTRY_TEMPLATES_ENABLED` is
  all-or-nothing — when off, NO templates load (regardless of whether
  any specific template is review-blocked).
- The gate is default-off in production. Setting it to `"true"` after
  domain expert review clears the review-blocked entries lights up the
  feature for end users.

## Version-bump policy

- **Patch** (1.0.0 → 1.0.1): typo fixes, description tweaks, no row
  added or removed, no enum value changed.
- **Minor** (1.0.0 → 1.1.0): new entries, new framework_ref values
  added to `FRAMEWORK_REFS`, criticality / priority adjustments.
- **Major** (1.0.0 → 2.0.0): row removals, structural changes
  (e.g. moving an entry from one section to another), changes to the
  loader contract that affect how rows land in customer tables.

`version` is read by analytics — bumping it on content change lets
us measure "what fraction of customers loaded the post-review version
of healthcare-saas?" cleanly. Don't lie to the version field.

## Framework_ref slugs

Slugs in `FRAMEWORK_REFS` map to the (name, version) pair upserted
into the per-org `frameworks` table at load time. Slugs are stable;
versions in the value can change if a framework version revises (e.g.
PCI-DSS 4.0.1 → 4.0.2 will be `pci-dss-4.0.1` until we replace the
slug entirely with a new release).

The `frameworks` table UNIQUE is `(organization_id, name, version)`,
so a customer who loads healthcare-saas and gets "NIST Cybersecurity
Framework / 2.0" will keep that row even if a future template
references "NIST Cybersecurity Framework / 2.0" — the upsert is a
no-op via DO UPDATE SET updated_at touch.
