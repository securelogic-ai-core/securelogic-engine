# Runbook — Enterprise Context Layer (ECL): Enable & Rollback

> **Audience:** operator / Simmee. **Status of the code:** Slices 1–10 are shipped **dark**
> to `develop` behind `SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED` (default **off**). Nothing in
> this runbook has been executed in prod. Enablement is **GATE B** and is *out of scope* for
> the build goal that produced the ECL — this document exists so the enable path is written
> down, not so it is performed now.
>
> Authoritative build record: `docs/validation/enterprise-context-goal-tracker.md`.
> Operator action ledger: `docs/validation/enterprise-context-operator-ledger.md`.
> Design blueprint: `docs/architecture/enterprise-context/ENTERPRISE_CONTEXT_ARCHITECTURE.md`.

---

## 1. What "enable" means

The ECL is gated on **two independent switches**, both of which must be true for a given org
to see any ECL behavior:

1. **Feature flag** — `SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED` (env var, declared in
   `render.yaml` as `false`). This is the global kill-switch. While it is `false`, every ECL
   route and worker is inert regardless of per-org state.
2. **Per-org capability** — `organizations.enterprise_context_capability` (boolean; `NULL` =
   inherit the Platform default). Enforced in-route by `requireCapability` (capability key
   `enterprise_context`) — see `src/api/lib/enterpriseContextCapability.ts`. Access model
   ruled under **GATE A** (2026-07-04): available to **Platform Professional + Enterprise**;
   Platform default on; per-org override via the column.

There is additionally a **presentation-only third switch** (Item 7): the same
`SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED` var on the **app** service (`securelogic-app`,
declared `false` in render.yaml; staging app is dashboard-only — ledger **L-8**) reveals the
"Context" header item. It is fail-closed and gates *navigation visibility only* — with it on
and the engine flag off, the screens render their "not available" state (every engine route
404s); with it off and the engine on, the pages are reachable by URL but unlisted. Full
enablement flips engine + app together.

Per-org resource ceilings (independent of `max_monitored_entities`):
- `organizations.max_enterprise_entities` — entity cap (migration `20260717`; GATE-A default **10,000**).
- `organizations.max_enterprise_edges` — relationship-edge cap (migration `20260728`; GATE-A default **50,000**; over-cap insert returns **409**).

---

## 2. Pre-enable checklist (all must hold before flipping the flag)

| Gate | What it is | Status |
|---|---|---|
| AD-17 capability grant | Per-org capability gate so enabling does not reach all rank-4 orgs | **Shipped** (Slice 9, `c495dc0c`) |
| H1 — edge cap | Bounded edge count per org (409 over-cap) | **Shipped** (Slice 9) |
| H2 — resolver load | Recursive graph resolver validated at enterprise fan-out | **Harness shipped** (Slice 10, `d3ad01ed`). **A true 10⁴–10⁵-edge volume run is still operator work — ledger L-6.** The 50k edge cap alone does *not* bound resolver latency (cost is path enumeration, super-linear at high fan-out); gate any cap increase on a per-org **p95 latency monitor**, and build the **materialized-adjacency fallback** before enabling any large-fan-out org (trigger ≈ p95 > 250 ms or > 10⁴ edges). See `docs/validation/enterprise-context-scale-findings.md`. |
| Staging soak | ECL enabled on a staging org, green for the soak window | **Pending** (operator) |
| UI (Item 7) | Context screens / graph view / import / nav | **Shipped dark** (7A.0–7A.4: #480 `4b566bad`, #481 `228f8f11`, #484 `d3ccad1e`, #485 `cca10015`, #486 `15ffac4d`). Rollup dashboards deferred pending an engine stats endpoint (tracker Item 7 note) |

---

## 3. Enable procedure (post-GATE-B, per operator authorization)

1. **Confirm §2 gates.** Do not proceed if H2's true-volume run (L-6) has not been done for
   the intended org's expected fan-out, or if the materialized-adjacency fallback is required
   but not built.
2. **Grant capability to the target org(s)** (no DDL, no deploy):
   ```sql
   -- grant
   UPDATE organizations SET enterprise_context_capability = true WHERE id = '<org-uuid>';
   -- (NULL leaves the org on the Platform default)
   ```
3. **(Optional) raise caps for an Enterprise org:**
   ```sql
   UPDATE organizations
      SET max_enterprise_entities = <n>, max_enterprise_edges = <n>
    WHERE id = '<org-uuid>';
   ```
4. **Flip the global flag** — set `SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED = true` in the
   Render env of the ECL-serving services (ledger **L-2**). This triggers a redeploy.
5. **Verify inertness lifts only where intended:** confirm a non-capability org still gets
   `404`/gate denial on ECL routes; confirm the target org can reach
   `GET /api/enterprise-entities`, `GET /api/enterprise-graph`, etc.
6. **Connectors** stay dark until per-connector credentials are provisioned (ledger
   L-5.1..L-5.9); only the ServiceNow CMDB reference adapter is implemented.

---

## 4. Rollback

ECL was built **flag-off-inert by construction** — every slice is dark with no callers on the
enabled platform paths. Rollback is therefore a clean switch-off, not a data migration:

1. **Immediate global disable:** set `SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED = false` (Render
   env) → redeploy. All ECL routes/workers return to inert. This is the primary kill-switch.
2. **Per-org disable** (leave the flag on for others): `UPDATE organizations SET
   enterprise_context_capability = false WHERE id = '<org-uuid>';`
3. **Data:** ECL tables are additive and org-scoped. The applicability decision store is
   **WORM** (append-only; UPDATE/DELETE/TRUNCATE blocked by trigger regardless of role) — do
   **not** attempt to delete decision rows as part of a rollback; disabling the flag is
   sufficient and preserves the auditable chain. No ECL table feeds any enabled platform
   surface, so leaving the rows in place has no runtime effect while the flag is off.
4. **No schema rollback is required** for a feature disable. If a migration must be reverted
   (unexpected), treat the WORM tables specially — the append-only trigger and hash chain must
   be dropped in a dedicated migration; a plain `TRUNCATE` on a parent hits the FK guard, not
   the trigger.

---

## 5. Operator action ledger cross-reference

| Ledger ID | Relevance to this runbook |
|---|---|
| L-1 | GATE A ruling — **RESOLVED** (access model + capability shape + caps) |
| L-2 | The prod flag flip in §3.4 — **GATE B, pending** |
| L-3 | CSV import per-org row-limit value (tunable via `UPDATE`) |
| L-5.1..L-5.9 | Connector credentials — required before any connector leaves dark |
| L-6 | Staging load-test data volume for the H2 gate in §2 |
| L-7 | Per-org grant/revoke + cap tuning (§3.2/§3.3, §4.2) — operational, no DDL |

No credentials are ever inlined in commands or committed. No prod DB writes by the build agent.
