# Example: adding an intelligence source

Adding an external feed is a **discrete package**, not a side effect (per
`TENANT_ISOLATION_STANDARD.md` §5 spirit and `BUILD_SEQUENCE.md` priorities 3–4). The
mechanism is verified in `src/api/lib/feedAdapter/` (registry + aggregator + pure mappers).
Read `source-ingestion.md` first.

## The shape

```
src/api/lib/feedAdapter/
├── registry.ts            ← the 8 registered feeds (id, url, tier, mapper)
├── index.ts               ← fetchAllFeeds({ ids? }) with per-feed error isolation
├── threatIntelHelpers.ts  ← pure RSS-item → CyberSignalIngestInput mapper
└── regulatoryHelpers.ts   ← pure regulatory-item mapper
```

## Steps

1. **Verify the URL is real and stable.** Live-fetch the RSS/JSON before committing.
   Sources with no discoverable feed (e.g. CMS) are deliberately *omitted*, not stubbed —
   a perpetually-failing feed is worse than none. Record the verification.

2. **Add a registry entry** in `registry.ts` (id, URL, tier, which mapper):
   ```ts
   {
     id: "cisa_advisories",
     url: "https://www.cisa.gov/cybersecurity-advisories/all.xml",
     tier: "tier1_regulatory",     // or threat-intel tier
     map: mapRegulatoryItem,        // reuse an existing pure mapper when the shape fits
   }
   ```

3. **Reuse a mapper if the item shape fits**; only add a new pure mapper for a genuinely new
   shape. A mapper turns one raw item into a `CyberSignalIngestInput` with: source id,
   `signal_type`, canonical **PascalCase severity**, title, summary, url, published-at, and
   any extracted CVE / vendor. Keep it pure (no I/O) so it's unit-testable.

4. **Dedup is automatic** — the normalizer (`cyberSignalNormalizer.ts`) builds the dedup
   hash and the insert uses `ON CONFLICT DO NOTHING` against the partial unique index.
   Signals are written **global** (`organization_id IS NULL`); do not org-scope them.

5. **Per-org fan-out is automatic** — the matcher (`runMatcherForSignal`) runs over active
   orgs at consumption time via all three schedulers (worker pipeline, KEV poller, daily
   brief). You don't wire fan-out per source; you feed the shared signal table.

6. **Tests** (unit, database-free):
   - mapper: a fixture raw item → the expected `CyberSignalIngestInput` (severity mapping,
     CVE/vendor extraction, missing-field handling);
   - dedup: two equivalent items collapse to one hash;
   - `fetchAllFeeds`: a failing feed doesn't block the others (per-feed error isolation).

## Don't
- Don't write a source's output straight into an org-scoped table.
- Don't add a source whose URL you haven't fetched and confirmed.
- Don't batch multiple orgs' private data into a shared enrichment LLM call (public-source
  enrichment may be batched; customer-private must be single-org — R6).
- Don't improve the *renderer* in the same change as adding a source — signal quality before
  presentation polish (`FINAL_PRODUCT_STANDARD.md`).

## Bigger ingestion work
Source qualification/credibility, near-duplicate clustering, and richer normalization are
**target architecture, not yet built** (`source-ingestion.md` Part B). Propose them as
sequenced packages under `BUILD_SEQUENCE.md` priorities 3–4; don't present them as existing.
