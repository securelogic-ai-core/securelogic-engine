# Performance & Reliability Backlog

> Tracking summary for performance / reliability work items. Kept intentionally separate from the [Security Backlog](./SECURITY_BACKLOG.md).
> **Last updated:** 2026-07-01. Priorities here are a record of the agreed triage — do not change them in this doc without re-triaging.

## Priority-ordered items

| Rank | Issue | Title | Priority | Promotion-gate (develop→main) | Effort | Dependencies | Related PR |
|---|---|---|---|---|---|---|---|
| 1 | [#437](https://github.com/securelogic-ai-core/securelogic-engine/issues/437) | PERF — engine cold-start latency affecting billing portal startup | P2 | **No** — not a develop→main blocker | Investigation S–M (~1–2d); mitigation M (findings-dependent) | None blocking; needs prod/staging instrumentation + confirmation of Render instance behavior (operator/platform fact); app-side UX already mitigated | [#436](https://github.com/securelogic-ai-core/securelogic-engine/pull/436) |

## Item detail

### [#437](https://github.com/securelogic-ai-core/securelogic-engine/issues/437) — Engine cold-start latency (billing portal startup)
- **Priority — P2.** The customer-facing *hang* is already mitigated (Sprint 3H degrades gracefully and never sticks), so this is a latency/quality improvement rather than an urgent defect — worth measuring/mitigating before paying customers routinely exercise Manage Billing.
- **Business impact — Medium.** Cold-start latency sits on the critical path of a **revenue action** (Manage Billing / upgrade / cancel); a slow first billing interaction is a poor first impression on the money path.
- **User impact — Medium, intermittent.** First Manage Billing click after the engine is idle or freshly deployed can wait several seconds (up to the 15s client attempt) before the portal opens or the graceful-retry state appears. Never stuck (post Sprint 3H), but still slow on a cold engine; warm/steady-state is fast.
- **Estimated effort — Investigation S–M (~1–2 days)** to measure and attribute the latency; **mitigation M**, dependent on findings (config/keep-warm is small; a boot-time refactor or async-portal path is larger).
- **Dependencies — none blocking.** Requires structured boot + `/billing/portal` instrumentation and confirmation of the Render instance behavior (**is the service actually spinning down?** — a platform fact to verify, not assume). Builds on the Sprint 3H app-side mitigation already on `develop`.
- **Promotion-gate impact — Not a develop→main blocker.** Independent quality work; not a Part-B operator gate.
- **Related PR — [#436](https://github.com/securelogic-ai-core/securelogic-engine/pull/436)** (Sprint 3H billing-portal UX fix, merged `develop` `faba6b8f`) — the follow-up source. The issue explicitly does **not** assume keep-warm is the solution; a measurement phase must justify the chosen option.

## Notes
- This backlog contains reliability/latency items only. Security items live in the [Security Backlog](./SECURITY_BACKLOG.md) and are not duplicated here.
