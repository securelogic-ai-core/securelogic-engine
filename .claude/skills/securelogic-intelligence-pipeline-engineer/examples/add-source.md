# Example: add an intelligence source (end-to-end)

A new feed is a **discrete package**. The mechanism is verified in
`src/api/lib/feedAdapter/`. Steps mirror the existing 8 registered feeds.

## 1. Live-verify the URL first (non-negotiable)
```bash
# Confirm the feed is real, parseable, and stable BEFORE committing a registry entry.
curl -sS -A "SecureLogic-FeedBot" https://www.cisa.gov/.../advisories.xml | head -40
```
A perpetually-failing feed is worse than none (that's why CMS is omitted). Record the check.

## 2. Reuse a mapper if the shape fits; else add a pure one
```ts
// src/api/lib/feedAdapter/regulatoryHelpers.ts  (reuse) — pure: raw item → signal
export function mapRegulatoryItem(item: RssItem, source: string): CyberSignalIngestInput {
  return {
    source,                                  // e.g. "cisa_advisories"
    signal_type: "advisory",
    severity: "Moderate",                    // canonical PascalCase; refine from content
    title: item.title?.trim() ?? "",
    summary: stripHtml(item.contentSnippet ?? ""),
    url: item.link ?? null,
    published_at: item.isoDate ?? null,
    cve: extractCve(item.title, item.content), // null if none
    vendor: null,
    external_id: item.guid ?? item.link ?? null,
  };
}
```

## 3. Register it
```ts
// src/api/lib/feedAdapter/registry.ts
{
  id: "cisa_advisories",
  url: "https://www.cisa.gov/cybersecurity-advisories/all.xml",
  tier: "tier1_regulatory",
  map: mapRegulatoryItem,
}
```

## 4. Nothing else to wire — these are automatic
- **Dedup:** `cyberSignalNormalizer` builds the hash; insert uses `ON CONFLICT DO NOTHING`.
  Signals are written **global** (`organization_id IS NULL`).
- **Fan-out:** the matcher runs over active orgs at consumption time via all three schedulers.
  You do **not** add per-source fan-out.

## 5. Tests (unit, database-free)
```ts
// src/api/lib/feedAdapter/__tests__/cisaAdvisories.test.ts
it("maps an advisory item to a signal with extracted CVE", () => {
  const sig = mapRegulatoryItem(FIXTURE_ITEM, "cisa_advisories");
  expect(sig.signal_type).toBe("advisory");
  expect(sig.cve).toBe("CVE-2026-12345");
  expect(sig.severity).toBe("Moderate");
});

it("two equivalent items dedupe to one hash", () => {
  expect(buildDedupHash(mapRegulatoryItem(ITEM, "s")))
    .toBe(buildDedupHash(mapRegulatoryItem(ITEM_DUP, "s")));
});

it("one failing feed does not block the others", async () => {
  const { results } = await fetchAllFeeds({ ids: ["cisa_advisories", "broken_feed"] });
  expect(results.broken_feed.error).toBeDefined();
  expect(results.cisa_advisories.mapped).toBeGreaterThan(0);
});
```

## Don't
- Don't write the source's output into an org-scoped table (global only).
- Don't bypass the normalizer / dedup.
- Don't bundle a renderer/layout change with the source (signal quality before polish).
- Don't add a source whose URL you didn't fetch and confirm.

## If asked for "source credibility scoring" / "clustering"
That's **RECOMMENDED**, not built (`BUILD_SEQUENCE.md` priorities 3–4). Propose it as a
sequenced package — do not implement it as if the architecture already exists.
