# Checklist — Intelligence Pipeline Engineer

For any change to sources, signals, the matcher, fan-out, or brief generation.

## Tenancy (BLOCKING)
- [ ] Public-source signals written **global** (`organization_id IS NULL`) to `cyber_signals`,
      never to an org-scoped table.
- [ ] Per-org work runs inside `withTenant(orgId)`, enumerated on `pgElevated`, per-org
      try/catch, `organizationId` on every log line.
- [ ] No LLM call batches more than one org's customer-private inputs (R6). Output persists
      only to the originating org.

## Matcher integrity
- [ ] Behavior change verified across **all three** invocation paths: `runPipeline.ts`,
      `kevPoller.ts`, `briefScheduler.ts`.
- [ ] `signal_match_suggestions` written with `match_score` (0–100), `match_metadata`, and the
      partial-unique-WHERE-pending semantics preserved (re-suggest after dismissal).
- [ ] `risk_scoring_weights` vocabularies kept separate (PascalCase severity vs lowercase
      criticality); KEV severity pin (1.0) intact.
- [ ] Findings created with the correct `source_type`; risk exposure flag + posture trigger
      reachable from worker fan-out (not just API ingest).

## Sources / ingestion
- [ ] New feed URL **live-verified** before commit; added to `registry.ts` with a mapper.
- [ ] Mapper is pure; reuses an existing one if the item shape fits.
- [ ] Dedup hash + `ON CONFLICT DO NOTHING` preserved; per-item dedup key not regressed
      (CVE-less signals must not collapse).
- [ ] Per-feed error isolation preserved (one feed failing doesn't block others); `feed_health`
      updated.

## Brief generation
- [ ] `BriefItem` shape intact (title, severity, category, affected_cve/vendor, analysis,
      why_it_matters, recommended_actions).
- [ ] Generator stays pure (no I/O); synthesis keeps the **template fallback** on LLM failure.
- [ ] No generic AI filler ("may affect posture", "organizations should review") — see
      **securelogic-executive-report-writer**.
- [ ] Renderer/layout NOT changed in the same package as signal-quality work.

## Flags & ops
- [ ] New risky behavior behind a `SECURELOGIC_*_ENABLED` flag, staged first.
- [ ] `ANTHROPIC_API_KEY` assumed on workers only; degrade safely if absent (503/template).

## Validation
- [ ] Unit tests (database-free): mapper fixtures, dedup hashing, normalizer, matcher scoring,
      `fetchAllFeeds` error isolation, brief output shape.
- [ ] If fan-out / per-org filtering changed → a cross-org isolation test (R5).

## Honesty
- [ ] Any source-qualification / clustering / staged-model work is labeled **RECOMMENDED**, not
      presented as existing architecture.
