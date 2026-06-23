# Vendor Fuzzy Match (Phase 2) — Rollout Tracking

Tracks the staged enablement of the Phase-2 fuzzy vendor matcher. The feature
shipped to prod **dormant** (PR #270 → #271, on `main` since `cf9daab0`,
2026-06-23) and does nothing until the flag is set.

## What it does

When the Phase-1 exact (canonicalize-then-exact) vendor/AI match finds **no**
match, fuzzy matching scores the signal's `affected_vendor` against the org's
active vendors with token-set Jaccard and writes **suggest-only** rows to
`signal_match_suggestions` (`target_type 'vendor'`, `match_reason
'vendor_fuzzy_match'`). It **never** creates a finding or flags a risk — a false
fuzzy match lands in the review queue, not in front of the customer.

- Module: `src/api/lib/vendorFuzzyMatch.ts`; wired in `cyberSignalProcessingService.ts`.
- Threshold: `FUZZY_VENDOR_MIN_SCORE = 60` (Jaccard×100). Min canonical length 5
  (short names exact-only). Cap 10 suggestions/(signal,org).

## The flag (dashboard-managed, OFF by default)

`SECURELOGIC_FUZZY_VENDOR_MATCH_ENABLED` — enabled only for the exact string
`true`. NOT in `render.yaml`; set per service in the Render dashboard.

**Must be set on BOTH services per environment** (the matcher runs in both; one
alone → inconsistent behavior):

| Env | Web service | Worker service |
|-----|-------------|----------------|
| staging | `securelogic-engine-staging` | `securelogic-intelligence-worker-staging` |
| prod | `securelogic-engine` | `securelogic-intelligence-worker` |

## Rollout plan (staging first — the measurement gate)

The off-by-default design exists so precision is measured on real vendors before
prod. Staging enablement IS that measurement.

1. **Staging:** set the flag `true` on both staging services → Render redeploys.
2. **Wait** ≥1 cron cycle (brief scheduler daily 07:00 UTC; KEV every 15 min).
3. **Measure precision** (read-only):
   ```sql
   SELECT match_score,
          match_metadata->>'matched_string' AS signal_vendor,
          match_metadata->>'candidate_name' AS suggested_vendor,
          organization_id, created_at
   FROM signal_match_suggestions
   WHERE match_reason = 'vendor_fuzzy_match'
   ORDER BY created_at DESC
   LIMIT 100;
   ```
   Volume by score:
   ```sql
   SELECT match_score, COUNT(*) FROM signal_match_suggestions
   WHERE match_reason = 'vendor_fuzzy_match' GROUP BY match_score ORDER BY match_score;
   ```
   Eyeball: are `signal_vendor → suggested_vendor` pairs genuinely the same
   company? Expect `palo alto networks → Palo Alto`-style wins.
4. **Decide:**
   - Good precision → set the flag on both **prod** services.
   - Too noisy → raise `FUZZY_VENDOR_MIN_SCORE` (code change, normal
     feat→develop→promote) before widening.
   - Back out → set staging vars `false`/delete; pending suggestions are dismissible.

## Known limitation (informs threshold tuning)

Pure token-Jaccard at 60 catches multi-token overlaps (`palo alto networks` ~
`Palo Alto` = 67) and rejects the common-word trap (`Oracle` ~ `Oracle Health`
= 50). It MISSES single-brand-token-vs-multiword (`Sensata Technologies` ~
`Sensata`, `Cisco Systems` ~ `Cisco`, both 50) — lowering to 50 would also admit
the Oracle false positive, so they're indistinguishable by Jaccard alone.
Recovering that tail needs token-distinctiveness weighting → **Phase 2.x**.

## Decision log

| Date | Env | Action | Threshold | Precision read | By |
|------|-----|--------|-----------|----------------|----|
| 2026-06-23 | prod | shipped dormant (flag unset) | 60 | n/a | — |
| _TBD_ | staging | enable both services | 60 | _pending_ | _operator_ |
| _TBD_ | prod | enable / tune / hold | _TBD_ | _TBD_ | _operator_ |
