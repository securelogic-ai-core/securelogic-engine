# Runbooks

Operational documentation, split by audience.

| Directory / file | Audience | Purpose |
|---|---|---|
| **`support/`** | Customer Support, Platform Ops | Diagnosing and escalating customer problems. Start at `support/README.md`. |
| `FEATURE-FLAG-ENABLEMENT-MATRIX.md` | Platform Ops | What is on, per environment. The most support-relevant document here. |
| `sept15-launch-runbook.md` | Platform Ops | Launch sequencing |
| `PRODUCTION_READINESS_CHECKLIST.md` | Platform Ops | Pre-release gate |
| `*-enable-rollback.md` | Platform Ops | Flag enablement and rollback per capability |
| `brief-scheduler-deploy-window.md` | Platform Ops | Brief scheduler deploy timing |
| `openai-credential-separation.md` | Platform Ops / Security | Incident-derived credential procedure |

Elsewhere:
- `docs/launch/` — launch-time gates and known issues. **`OPERATOR_RUNBOOK.md`
  there is stale (2026-07-21) and predates the SL-BILL-1 billing changes** — see
  `support/SUPPORT-READINESS-GAPS.md` (SUP-PROC-2).
- `docs/release/` — release-specific promotion runbooks
- `docs/DR_PLAN.md` — disaster recovery
