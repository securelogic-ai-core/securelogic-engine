# IQP — Operator Ledger

Operator-only actions required by the Intelligence Quality Program (IQP).
Governing doc: `docs/architecture/intelligence-quality/IQP-PHASE-1-AUDIT.md`.
Engineering NEVER performs these; each row is owned by the operator. Staging
first, production only after staging validation passes the package's exit gate.

| # | Package | Service | Variable / value | Exact step | Dependency |
|---|---|---|---|---|---|
| OP-1 | Q1 — HTML sanitization | `securelogic-engine-staging`, then `securelogic-engine` | `SECURELOGIC_SIGNAL_SANITIZE_ENABLED=true` | Render dashboard → service → Environment → add var → save (service restarts). Validate in staging: new signals' `normalized_summary` contains no `<tag>`/`&entity;` artifacts; brief items' titles/summaries clean; then enable prod. | Q1 merged to develop and deployed to the service |

(Rows are appended as later IQP packages land; see each package's PR for the
exact validation query/steps.)
