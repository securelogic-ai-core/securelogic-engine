# Examples

Copy-correct templates for the most common tasks in this repo. Each mirrors a **real,
verified** pattern in the codebase — the cited "reference file" is the source of truth, so
when in doubt, open it. These exist so future work **extends** the established shape instead
of inventing a divergent one.

| File | Task | Reference file(s) in the repo |
|---|---|---|
| `route-handler.md` | Add a customer-data REST route (CRUD) | `src/api/routes/actions.ts`, `risks.ts` |
| `service-and-validation.md` | Add a `lib/` service + a hand-written validator | `src/api/lib/*Validation.ts` |
| `migration.md` | Write a migration (table + index + RLS policy) | `db/migrations/20260619_findings_rls_pilot.sql`, `20260620_*` |
| `worker-job.md` | Add durable async work on the `jobs` queue | `src/api/workers/dataRightsWorker.ts`, `dataRightsWorkerPolicy.ts` |
| `intelligence-source.md` | Add an ingestion source / signal | `src/api/lib/feedAdapter/registry.ts`, `index.ts` |
| `code-review.md` | Review a diff / PR in this codebase | `pr-checklist.md`, `security-review.md` |
| `pr-description.md` | Write a PR description | `pr-checklist.md` §11 |

**Before using any template:** do the SKILL.md §3 seven-section brief, and read the
reference file — these snippets are illustrative skeletons, not a substitute for the real,
current code.
