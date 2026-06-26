# Reference — Enterprise Architect

This skill predates the standard four-file layout and carries a **richer companion set**.
This `reference.md` is the index + consolidated quick-reference; the deep material lives in
the companion files (do not duplicate — read them).

> Evidence labels used across the suite: **VERIFIED** (read in the repo), **INFERRED**
> (deduced, not directly confirmed), **RECOMMENDED** (proposed, not built), **UNKNOWN**
> (needs manual confirmation). The code is the final authority.

## Companion files (the real reference)

| File | Scope |
|---|---|
| `architecture.md` | System map: services, layers, dependency direction, request lifecycle, tenant runtime, pipeline, jobs, deployment, live-vs-dead code zones. |
| `domain-model.md` | Entities, ownership, relationships, canonical enums, locked decisions. |
| `source-ingestion.md` | Feeds → signals → matcher → brief (Part A verified / Part B recommended). |
| `security-review.md` | Auth, authz, tenant isolation, secrets, audit, uploads, LLM/AI safety. |
| `database-guidelines.md` | Migrations, tenant scoping, RLS template, query patterns, indexing. |
| `api-guidelines.md` | Route conventions, middleware chain, validation, errors, pagination, audit. |
| `testing-guidelines.md` | Unit vs cross-org isolation lanes; negative-path requirements. |
| `pr-checklist.md` | Full enterprise PR review grid (see also this skill's `checklist.md`). |
| `roadmap-assumptions.md` | Build sequence, deferred items, what NOT to build. |
| `examples/` | Copy-correct templates: route, migration, worker, service+validation, source, review, PR. |

## Consolidated quick-reference (VERIFIED)

- **Monorepo:** engine `src/` (Node 20 / Express 5 / TS, ~112 routes), app `app/` (Next 15.5 /
  React 18), website `website/` (Next 15.5 / React 19, static export), `packages/contracts`,
  5 worker services in `services/`.
- **Data:** raw `pg`, no ORM; ~125 SQL migrations (`db/migrations/`), ~76 tables, enums as
  `CHECK` constraints; migrations run on engine boot.
- **Tenant unit:** `organizations.id`. Live defense = `WHERE organization_id = $n` from
  `req.organizationContext`. RLS = ~22 tables, **INERT pre-flip** (owner cred, NOT FORCE).
- **Auth chain (per route):** `requireApiKey → attachOrganizationContext →
  requireEntitlement(level) → handler`. Entitlement ranks: starter 1 / standard=professional 2 /
  premium 4. Source of truth: `organizations.entitlement_level` (Stripe-written).
- **Tenant runtime:** `src/api/infra/postgres.ts` — `pg` / `pgElevated` / `pgRaw` /
  `withTenant` / `asTenant`.
- **Scoring:** pure `src/engine/scoring/v2/*` (V2 default); posture NULL on zero findings.
- **Deploy:** Render, `render.yaml`, 7 prod + 6 staging services; `main`→prod, `develop`→staging.

## Cross-skill routing

- Security depth → **securelogic-security-reviewer**
- Feeds/signals/matcher/brief → **securelogic-intelligence-pipeline-engineer**
- AI systems / frameworks / controls / obligations → **securelogic-ai-governance-expert**
- Briefs / memos / exec summaries → **securelogic-executive-report-writer**
- PR / migration / release review → **securelogic-release-pr-reviewer**
- Build sequence / what's next / doc-sync → **securelogic-program-manager**

This skill stays the **arbiter of architecture, layering, domain model, and tenant +
entitlement boundaries**; the others defer to it on those.
