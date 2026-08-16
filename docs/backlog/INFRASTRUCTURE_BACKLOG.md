# Infrastructure Backlog

> Tracking summary for infrastructure / IaC-ownership work items. Kept separate
> from the [Security Backlog](./SECURITY_BACKLOG.md) and the
> [Performance & Reliability Backlog](./PERFORMANCE_RELIABILITY_BACKLOG.md).
> **Last updated:** 2026-08-16.

## Priority-ordered items

| Rank | ID | Title | Priority | Promotion-gate (develop→main) | Effort | Dependencies |
|---|---|---|---|---|---|---|
| 1 | INF-1 | Three services run outside Blueprint ownership | P2 | **No** — not a promotion blocker | S to decide, M–L to adopt | Operator ownership ruling; demo DB migration-drift reconciliation |

## Item detail

### INF-1 — `demo-engine`, `demo-app` and `intelligence-api` are outside Blueprint ownership

**Status: OPEN — intentional today, decision owed. Do NOT add them to
`render.yaml` without an explicit ownership ruling.**

**What is true.** `render.yaml` declares **fourteen** services. These three are
not among them and never have been:

| Service | Live state (2026-08-16) | autoDeploy | In `render.yaml`? |
|---|---|---|---|
| `securelogic-demo-engine` | `live` on `98e97098` | **no** (held) | **no** |
| `securelogic-demo-app` | `live` on `98e97098` | **no** (held) | **no** |
| `securelogic-intelligence-api` | `update_failed` on `759e7c94` since 2026-05-02 | **no** (held) | **no** |

They exist only as Render dashboard state. Every other `main`- and
`develop`-tracking service is Blueprint-declared.

**Why this is being recorded rather than fixed.** Surfaced during the Stage-1
promotion (2026-08-16), when the four `autoDeploy=false` holds were written back
into IaC. Only `securelogic-website` could be expressed, because it is the only
one of the four the Blueprint owns. Declaring the other three would mean ADDING
complete service definitions — branch, build and start commands, environment —
which is not "recording a hold": it hands the Blueprint control of services it
has never managed, and the first sync would then assert that definition over
whatever the dashboard actually holds. On a service already in `update_failed`,
and on a demo pair whose database carries unresolved migration drift, that is a
change with real blast radius. It needs a decision, not a commit.

**The risk of leaving it.** These three are invisible to review. A change to
them leaves no diff, no PR, and no history — the same class of gap that produced
a P0 on 2026-08-14, when a `render.yaml` value and the live value disagreed and
nothing detected it. Their current holds live only in §11 of
`docs/validation/develop-to-main-promotion-audit.md` and in this item.

**The decision required, per service.**
1. **Adopt** into `render.yaml` — capture live config exactly, then verify a
   sync is a no-op before enabling autosync. For `intelligence-api` the
   `update_failed` condition must be reconciled *first*, or adoption will
   codify a broken definition. For the demo pair the DB migration drift must be
   resolved first, since adoption implies they will move with `main`.
2. **Decommission** — `intelligence-api` has not deployed successfully since
   2026-05-02; whether it is still load-bearing is itself unanswered.
3. **Deliberately exclude** — keep them dashboard-only, but record that as a
   ruling here so the absence stops reading as an oversight.

**Promotion-gate impact — none.** Stage 1 completed with all three held. They
are not a Stage 2 blocker either. This is IaC hygiene and operational
visibility, not release risk.

## Notes
- Blueprint autosync is **off** and the Blueprint is **paused**. Nothing in this
  backlog has been applied to any service.
