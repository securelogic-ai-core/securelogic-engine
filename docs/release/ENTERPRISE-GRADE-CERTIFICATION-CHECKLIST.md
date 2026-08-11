# Enterprise Grade Certification Checklist

Ratified 2026-07-31 following EG2 Certification Addendum 001 (a worker-only compile
failure survived certification because no gate compiled the worker). **A branch may not
be declared certified until every gate below has been run on that branch's exact HEAD,
with results recorded.** "The CI would have caught it" does not count: CI does not run
on feature-based PRs, so certification must reproduce CI's gates locally.

The governing rule: **verify every deployable artifact with the exact command its
deployer runs.** Green tests do not imply a green deploy — vitest strips types; only
the artifact's own compiler proves the artifact.

## Mandatory gates

| # | Gate | Command | Proves |
|---|---|---|---|
| 1 | Engine typecheck | `npm run typecheck` | tsconfig.ci strictness on engine |
| 2 | App typecheck | `cd app && npx tsc --noEmit` | Next app types (not covered by #1) |
| 3 | Lint | `npm run lint` | style/correctness gate parity with CI |
| 4 | URL drift | `node scripts/check-env-url-drift.mjs` | no prod hosts in app/website source |
| 5 | Engine tests | `npm test` | full engine + worker + packages vitest suite |
| 6 | App render tests | `cd app && npm run test` | customer-facing route contracts |
| 7 | Engine build | `npm run build` | the engine deploy artifact (tsconfig.prod) |
| 8 | **Worker build** | `npx tsc -p services/intelligence-worker/tsconfig.json` | the worker deploy artifact — Render's exact buildCommand |
| 9 | App build (deploy parity) | `cd app && npm run build` | the Next production build Render runs — type errors here otherwise surface only as a red deploy |
| 10 | Isolation harness | `scripts/harness-db-up.sh` + `npm run test:isolation` | cross-org tenant isolation against real Postgres |
| 11 | Audit (recorded) | `npm audit --audit-level=high` | dependency posture — compare against the develop baseline; pre-existing reds are recorded, never silently absorbed into "green" |
| 12 | Release documentation | manual | release/certification docs updated; doc drift from shipped reality called out |
| 13 | Deployment artifacts | manual | render.yaml deltas reviewed: new env vars declared, flags default-dark, buildCommands unchanged or intentionally changed |
| 14 | Operational readiness | manual | monitoring/alerting for the new behavior exists; rollback path stated; operator actions separated from engineering |

## Recording requirements

- Certification verdicts MUST be written into the branch's release/experience report
  with the gate table and per-gate results — an in-session verdict with no repo
  artifact is not a certification.
- Any gate skipped or red must be listed by name with a reason and an owner —
  absence of a claim is not coverage.
- New deployable artifacts (services added to render.yaml) automatically extend
  gates 7–9: one build gate per deployable, using the deployer's exact command.

## Recommended additional gates (adopt when tooling permits)

- Migration dry-run against a schema snapshot (catches irreversible/ordering issues).
- `npm run check` (guard-imports + url-drift + lint + typecheck + build + frozen-prod
  tests) as a single pre-certification convenience command.
- Website workspace build (`cd website && npm run build`) when website/ files changed.
