# Item 10 — Enterprise graph resolver: scale findings

Written findings for the recursive graph resolver (`enterpriseGraphResolver.ts`, the
repo's `WITH RECURSIVE`) — the H2 prod-enable gate. Harness:
`test/isolation/enterpriseGraphScale.test.ts` (seeds a graph, runs `EXPLAIN (ANALYZE,
BUFFERS)` on the exact nodes query at each depth, asserts boundedness + cycle-safety).

Numbers below are from the **CI/local harness scale** (Postgres 16, a 400-wide fan-out
hub → ~800 reachable nodes, a 150-node deep chain, and a 3-node cycle). This establishes
the cost SHAPE and a baseline; the true Fortune-500 volume run (10⁴–10⁵ nodes, dense
fan-out) is the operator **L-6** action (a staging org seeded at that volume) — a sandbox
cannot synthesize it meaningfully.

Date: 2026-07-04.

---

## Measured numbers

**Fan-out hub** (FANOUT = 400; ~801 nodes fully reachable by depth 2):

| depth | distinct nodes | EXPLAIN ANALYZE exec time |
|------:|---------------:|--------------------------:|
| 1 | 401 | ~5.0 ms |
| 2 | 801 | ~126.6 ms |
| 3 | 801 | ~129.2 ms |
| 4 | 801 | ~145.4 ms |
| 5 | 801 | ~184.4 ms |

**Deep chain** (150 nodes): depth 5 → **6 nodes, ~1.5 ms**.
**Cycle** (A→B→C→A): terminates, **3 nodes** (visited-array guard holds).

---

## Observations

1. **Cost is driven by fan-out + path enumeration, not distinct node count.** The
   reachable set is complete at depth 2 (801 nodes), yet latency keeps climbing
   depth 2→5 (127 → 184 ms) while the node count is flat. The recursive term re-expands
   every path and the cycle guard `NOT ((… ) = ANY (r.visited))` is O(path-length) per
   recursive row, so cost scales with the number and length of *paths*, not the number of
   *nodes*. The depth-1→2 step (5 → 127 ms) is where the wide fan-out expands.
2. **Narrow/deep is cheap; wide is expensive.** The 150-deep chain resolves in ~1.5 ms at
   depth 5 (6 nodes) — depth alone is not the problem. Fan-out is the cost driver, which is
   exactly the enterprise-graph shape (one vendor → many apps/services/owners).
3. **Cycle-safety confirmed** at this scale (terminates, no blow-up).
4. **MAX_DEPTH = 5 is load-bearing.** It's the only hard bound on path length today; do not
   raise it without re-running this harness at target volume.

## Extrapolation to Fortune-500 (H2 — still open)

At ~800 nodes / ~800 edges the per-request cost is already ~180 ms. Because cost grows with
path count × path length (not node count), a dense enterprise graph (10⁴–10⁵ nodes, high
fan-out, multiple parents) will grow **super-linearly** and breach acceptable request
latency well before it exhausts memory. **H2 remains a real prod-enable gate** — the live
recursive CTE is safe for small/moderate graphs but not proven at enterprise fan-out. The
operator L-6 run must produce the numbers at true volume before the flag is enabled for a
large org.

## Materialized-adjacency decision

**Decision: keep the live recursive CTE as the default; build a materialized-adjacency
fallback before enabling ECL for any large-fan-out org.** Design (not built this slice):
a per-org reachability/closure table (or a cached neighbourhood) refreshed on edge change
(the S7 `edge_changed` event is the natural trigger), consulted instead of the live CTE
when an org's edge count or measured p95 crosses a threshold. Rationale: the CTE is simplest
and correct for the common case; precomputation only pays off past the fan-out knee this
harness locates (~hundreds of ms). Trigger to build: first Enterprise org whose graph
pushes resolver p95 past ~250 ms, or edge count past ~10⁴.

## Partitioning strategy

**Decision: defer physical partitioning; the org-scoped filter + indexes localize scans
today.** When a single org's `enterprise_relationships` approaches ~10⁵ live edges,
**hash-partition `enterprise_relationships` by `organization_id`** — it aligns perfectly
with the resolver's `WHERE organization_id = $1` and keeps each partition to one tenant.
The WORM applicability tables (S4b) partition by `created_at` **range** if/when volume
warrants (already noted in the S4b reconciliation — deferred to pre-first-write). No
partitioning is in the repo yet; introducing it is its own migration + rewrite-while-empty
window, so it is gated on real volume, not done speculatively.

## Interaction with the GATE A caps

The ruled caps (**10k entities / 50k edges** per org) keep an org within a bounded envelope,
but **50k edges is well past the ~800-edge point where latency is already ~180 ms** — so the
edge cap alone does not guarantee resolver latency. Recommendation: before enabling ECL for
an org near the cap, either (a) run L-6 at that org's real shape, or (b) ship the
materialized-adjacency fallback. A per-org resolver p95 monitor should gate any cap increase.

## Operator action (ledger L-6)

Provision a staging org seeded at 10⁴–10⁵ entities with enterprise-realistic fan-out and
re-run `enterpriseGraphScale.test.ts` (or an equivalent) to capture the real numbers; feed
them back into the materialized-adjacency build trigger and any cap revision.
