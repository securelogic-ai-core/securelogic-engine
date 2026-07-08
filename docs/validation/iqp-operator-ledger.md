# IQP — Operator Ledger

Operator-only actions required by the Intelligence Quality Program (IQP).
Governing doc: `docs/architecture/intelligence-quality/IQP-PHASE-1-AUDIT.md`.
Engineering NEVER performs these; each row is owned by the operator. Staging
first, production only after staging validation passes the package's exit gate.

| # | Package | Service | Variable / value | Exact step | Dependency |
|---|---|---|---|---|---|
| OP-1 | Q1 — HTML sanitization | `securelogic-engine-staging`, then `securelogic-engine` | `SECURELOGIC_SIGNAL_SANITIZE_ENABLED=true` | Render dashboard → service → Environment → add var → save (service restarts). Validate in staging: new signals' `normalized_summary` contains no `<tag>`/`&entity;` artifacts; brief items' titles/summaries clean; then enable prod. | Q1 merged to develop and deployed to the service |
| OP-2 | Q2 — recency migration | staging DB, then production DB | migration `20260828_cyber_signals_published_at.sql` | Run the migration (adds nullable `published_at` + index + exception-safe backfill from `raw_payload` date keys). Backfill-safe by construction: nothing reads the column until OP-3, and old dates only ever REMOVE rows from the brief window — historical intelligence is never re-surfaced as new. | Q2 merged and deployed |
| OP-3 | Q2 — recency flag | `securelogic-engine-staging`, then `securelogic-engine` | `SECURELOGIC_SIGNAL_RECENCY_ENABLED=true` | Render dashboard → Environment → add var → save. Validate in staging: generate a brief; confirm no item's `published_at` predates the window and the `stale_signal_suppressed` log fires when old-dated rows sit in the ingestion window. Treat the first post-enablement KEV cycle as controlled backfill (ancient `dateAdded` entries are suppressed automatically). Then enable prod. | OP-2 applied on the same environment |
| OP-4 | Q3 — relevance flag | `securelogic-engine-staging`, then `securelogic-engine` | `SECURELOGIC_BRIEF_RELEVANCE_ENABLED=true` | Render dashboard → Environment → add var → save. Validate in staging: (a) an unmonitored-filer `third_party_breach` fixture does NOT appear in the generated brief and `irrelevant_signal_suppressed` logs; (b) a news-shaped FTC item renders under General while a rulemaking item stays under Regulatory & Compliance. Then enable prod. | Q3 merged and deployed |
| OP-5 | Q4 — quality flag | `securelogic-engine-staging`, then `securelogic-engine` | `SECURELOGIC_BRIEF_QUALITY_ENABLED=true` | Render dashboard → Environment → add var → save. Validate in staging: generate a brief — no title ends in a bare `...` or a mid-word cut; no item's summary equals/prefixes its title; no two items share a title (case-insensitive). Then enable prod. | Q4 merged and deployed |

(Rows are appended as later IQP packages land; see each package's PR for the
exact validation query/steps.)
