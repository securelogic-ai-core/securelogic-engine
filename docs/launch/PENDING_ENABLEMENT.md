# Pending operator enablement — the launch checklist behind PRs #699–#704

**Status:** operator runbook. Everything in this file is deliberately NOT done
by the implementation PRs — per the implementation rule, code ships complete
and dark, operator-controlled configuration stays untouched, and this document
records exactly what must be enabled and in what order. Each row cites its
authority (a ruled decision or a filed issue), so nothing here is a new
decision.

Last sync: 2026-07-28, after PRs #699 #700 #701 #702 #703 #704.

---

## 1. Revenue-critical — this week (DS-11, Launch Blocker)

### 1.1 Platform trial flag
The "Start Free Trial" CTAs are live on the website while the trial flag is
off — those CTAs charge $7,200 (annual) immediately (`render.yaml:178-182`
carries the in-file warning; execution path verified in the 2026-07-28
commercial-flow review).

1. **Staging validate:** set `SECURELOGIC_PLATFORM_TRIAL_ENABLED="true"` on
   the staging engine service; run a trial checkout on `[SEED] Walkthrough
   Org`; confirm the Stripe subscription is `trialing` with
   `trial_period_days=14`, no immediate charge, and `trial_started_at`
   stamped once (idempotent).
2. **Prod flip:** same var on the prod engine service. Blueprint-sync gotcha
   applies (§4).
3. **If the flip slips past the week:** interim CTA copy change to
   "Get Platform" (website `TRIAL_HREF` call sites + pricing page buttons).
4. **Refund sweep (Decision Review assumption #1):** search Stripe for
   full-price checkouts whose sessions originated from trial CTAs; refund
   proactively.

## 2. Follow-ups from the shipped defect fixes

### 2.1 D-14 durable guard (after PR #703)
The write-path guard is live once #703 merges (no enablement needed). Two
operator items remain:
- **Measure before backfill:** run
  `scripts/measure-cyber-signal-finding-duplicates.sql` against prod
  (read-only) and rule on the legacy-duplicate disposition using the status
  mix it reports.
- **Approve the backstop migration:** a partial unique index on
  `findings (organization_id, source_id) WHERE source_type='cyber_signal'`
  (mirror of `idx_findings_intelligence_event_unique`, `20260823`). Ships as
  its own additive migration PR on approval; blocked only on that approval.

### 2.2 Seat-cap correction for existing platform orgs (after PR #704)
New/renewing platform subscriptions self-correct to the advertised 10 seats
on their next Stripe grant event. Existing platform orgs still capped at 6
can be corrected immediately via the existing admin path
(`PATCH /admin/organizations/:id`, `max_members: 10`) if waiting for the next
renewal event is not acceptable.

### 2.3 TENANT_ISOLATION §9 rider (after PR #704)
Next doc-sync should add a §9 note recording the teams-tier capability gate
(`requireTeamCapability`: premium ranks ∪ `stripe_subscription_tier='teams'`,
team-management routes only). Code shipped first under the implementation
rule; the amendment records it.

## 3. Staging observability — Canonical Path B (DS-10, #693)

Declared-in-code but absent from every `render.yaml` service block; C5 is
unreachable in all environments until declared. Per DS-10 (Approved:
staging-surface, prod untouched, GATE B intact), the operator adds:

| Var | Staging | Prod |
|---|---|---|
| `SECURELOGIC_SIGNAL_APPLICABILITY_ENABLED` (engine) | `"true"` | absent/off |
| `SECURELOGIC_SIGNAL_APPLICABILITY_MODE` (engine) | `"surface"` | absent |
| `SECURELOGIC_APPLICABILITY_WORKFLOW_ENABLED` (worker) | `"true"` | stays `"false"` |

Post-flip checks: flag-off byte-identity gate stays green on prod-shaped
config; applicability decisions actually written on the staging worker; then
start C8/C9 agreement-rate collection.

## 4. Blueprint-sync gotcha (applies to §1 and §3)

Render Blueprint syncs have silently skipped newly declared env vars in this
repo before (documented lineage: the #647 risk-acceptance flag needed a
manual operator Blueprint sync; probe pattern: a gated route moving 404→401
proves the flag landed). After any render.yaml change, verify the new vars
exist on the service in the Render dashboard — do not trust the deploy alone.

## 5. Already-red CI lane (repo-wide, not PR-caused)

`audit` (`npm audit --audit-level=high`) fails on develop itself — 19 high
advisories (js-yaml, postcss GHSA-r28c-9q8g-f849, …) — and has been red across
recently merged PRs. Needs one dependency-bump PR (`npm audit fix` covers the
non-breaking set); until then every PR shows 7/8 green through no fault of
its diff.

## 6. Explicitly NOT pending enablement (ruled gates, not config)

- **#694 / #695-erasure / #697** — gated on ADR-0004/0005/0006 acceptance
  (PROPOSED in PR #698; merging that PR registers, not accepts).
- **RLS `app_request` flip** — gated on D-13 verification + pending-table
  policies + elevated-channel audit (#695); the flip itself is a staged
  credential swap with rollback, never a flag.
- **GATE B / prod dark-launch discipline** — unchanged by everything above.
