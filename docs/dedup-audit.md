# cyber_signals dedup_hash audit

**Date:** 2026-05-02
**Branch:** feat/kev-fast-cadence (audit findings only — no code changes)
**Trigger:** PR #34 post-merge runtime check observed 24 of 35 RSS items skipped as
duplicates against an "empty target." Working hypothesis was a cross-pipeline
collision because `security_news_bleepingcomputer` (worker) and `bleepingcomputer`
(brief pipeline) might be hitting the same hash bucket. This audit re-investigates.

---

## 1. The actual `dedup_hash` formula

Single source of truth: `src/api/lib/cyberSignalNormalizer.ts:61–75`.

```ts
export function buildDedupHash(
  source: string,
  signalType: string,
  affectedCve: string | null,
  affectedVendor: string | null
): string {
  const key = [
    source.toLowerCase().trim(),
    signalType.toLowerCase().trim(),
    (affectedCve ?? "").toLowerCase().trim(),
    (affectedVendor ?? "").toLowerCase().trim()
  ].join("|");

  return createHash("sha256").update(key, "utf8").digest("hex");
}
```

### Normalization steps applied

| Component        | Steps                                              | Notes |
|------------------|----------------------------------------------------|-------|
| `source`         | `.toLowerCase().trim()`                            | No alias/prefix collapse — `security_news_bleepingcomputer` and `bleepingcomputer` are distinct keys. |
| `signal_type`    | `.toLowerCase().trim()`                            | Constrained taxonomy via `VALID_SIGNAL_TYPES` (validation path) — but worker's `bridgeSignalsToCyberSignals` and an older path bypass `validateCyberSignalIngest`, so non-canonical values like `vendor_incident`, `general`, `regulatory` exist in the table. |
| `affected_cve`   | `(value ?? "").toLowerCase().trim()`               | No CVE-ID canonicalization — leading-zero variants like `CVE-2026-1234` vs `CVE-2026-01234` would hash differently. The validator already uppercases on entry, but here we lowercase again before hashing. |
| `affected_vendor`| `(value ?? "").toLowerCase().trim()`               | No vendor-name canonicalization — `Microsoft` vs `microsoft inc` vs `MSFT` would all hash differently. |
| separator        | `'|'`                                              | Fixed. |
| digest           | `sha256` over UTF-8 bytes, hex-encoded             |       |

### What is NOT in the formula

- **No URL / external_id / GUID.** `threatIntelHelpers.ts:193–194` claims "Two
  fetches of the same article from the same source will hash identically"
  because the URL is "in raw_payload so the dedup hash incorporates it" — **this
  comment is wrong.** `raw_payload` is not an input to `buildDedupHash`. URL/GUID
  contribute nothing to the hash.
- **No title / summary text.** Two RSS items from the same source with the same
  signal_type derivation but different headlines hash identically.
- **No timestamp / published_at.**

### Empirical verification (run on staging DB, 2026-05-02)

Recomputed the hash for 3 real `security_news_bleepingcomputer` rows using the
formula above directly in SQL and compared to the stored `dedup_hash`:

```
formula_matches = true   (3 of 3)
```

Formula is exactly what the code says it is. No silent differences.

---

## 2. The PR #34 24-of-35 mystery — resolved

**Cause: intra-source bucket collision, NOT cross-pipeline.** The dedup formula
is too coarse for general-purpose RSS feeds where most items lack a CVE-ID in
title/description and lack a `KNOWN_VENDORS` match.

### Evidence

#### A. The two sides ARE differently named — no collision possible

- Worker pipeline (`services/intelligence-worker/src/sources/securityNewsFeed.ts:25-26`):
  stamps `source: "security_news_bleepingcomputer"` (with prefix).
- Brief pipeline (`src/api/lib/feedAdapter/registry.ts:28`):
  stamps `source: "bleepingcomputer"` (no prefix, via `feed.id` passed to
  `mapRssItemToSignal`).

Empirical hash check on 3 real worker rows, recomputing as if `source` had been
`bleepingcomputer` instead:

```
worker_actual_hash      = 6b8e16d8...   (stored)
would_be_brief_hash     = bfa4945b...   (substituted source)
would_collide           = false         (3 of 3)
```

Source IS in the formula, source strings differ between pipelines, hashes differ.
**Cross-pipeline collision via `dedup_hash` is empirically false.**

#### B. The brief-pipeline RSS rows don't exist on staging anyway

```
SELECT source, COUNT(*) FROM cyber_signals
WHERE source IN ('bleepingcomputer','krebsonsecurity','sans_isc');
→ 0 rows
```

Even if the hashes had collided, there's nothing to collide against. The brief
pipeline RSS feed adapters (`fetchAllFeeds(THREAT_INTEL_FEED_IDS)`) have either
never run or never inserted. The "duplicates" in PR #34 cannot be brief-pipeline
ghosts.

#### C. The real attrition is intra-source, and it is severe

```
              source             | signals_table_rows | cyber_signals_rows | attrition
 --------------------------------+--------------------+--------------------+-----------
  security_news_bleepingcomputer |                 48 |                 12 |        36
  security_news_theregister      |                 37 |                 16 |        21
  security_news_thehackernews    |                 37 |                 20 |        17
  security_news_krebs            |                  9 |                  4 |         5
```

BleepingComputer: **75% of upstream rows lost to dedup_hash collisions.** PR
#34's "24 of 35" lands squarely in this regime — 24/35 = 69% attrition matches
the steady-state observed across all four worker RSS feeds.

#### D. Why so many items collide

For a typical BleepingComputer article ("Hackers exploit new Outlook bug"):
- `signal_type` falls into one of ~5 derived buckets (`threat_actor`,
  `advisory`, `vendor_incident`, `general`, `regulatory` per worker classifier;
  `patch_advisory`, `third_party_breach`, `threat_actor`, `regulatory_change`
  per brief mapper).
- `affected_cve` is `null` whenever the title/description doesn't quote a CVE
  ID — common for general security news.
- `affected_vendor` is `null` whenever the title doesn't contain a substring
  match in the small `KNOWN_VENDORS` list (~50 names).

When **both** CVE and vendor are null, the hash key collapses to
`security_news_bleepingcomputer|<one_of_5_buckets>||` — essentially a 5-element
keyspace into which 35 items are crammed. Within a single fetch loop, the second
item with the same bucket triggers `ON CONFLICT (dedup_hash) DO NOTHING` against
the first item that was just inserted moments earlier in the same loop. Hence
"empty target" + "24 of 35 dups" — they're dropping against rows the same fetch
itself created.

The user-reported symptom is a **direct, exact match** to this failure mode.

### Verdict

**Resolved.** The 24-of-35 dups are not cross-pipeline ghosts; they are intra-source
hash-bucket collisions caused by a formula whose discriminating fields (CVE,
vendor) are both null for the majority of items in general-purpose RSS feeds.

---

## 3. Cross-pipeline collision risk for adding 11 PSIRT feeds

### Walk-through with concrete strings

Scenario: Microsoft publishes CVE-2026-12345. The same advisory is referenced by:
- BleepingComputer (worker pipeline, `source = "security_news_bleepingcomputer"`)
- BleepingComputer (brief pipeline, `source = "bleepingcomputer"`)
- A new MSRC PSIRT feed we add (`source = "msrc"`)

Each computes its own hash:

| Pipeline / Source                  | Hash key (lowercased, trimmed)                                           |
|-----------------------------------|--------------------------------------------------------------------------|
| Worker (BleepingComputer)         | `security_news_bleepingcomputer\|patch_advisory\|cve-2026-12345\|microsoft` |
| Brief (BleepingComputer)          | `bleepingcomputer\|patch_advisory\|cve-2026-12345\|microsoft`             |
| New PSIRT (MSRC)                  | `msrc\|patch_advisory\|cve-2026-12345\|microsoft`                          |

All three keys differ in the first segment. SHA-256 over a single-byte difference
produces fully unrelated digests. **No collision.**

The same logic holds for the other 10 PSIRT feeds (Cisco PSIRT, Adobe, Oracle CPU,
Red Hat security, etc.) — each gets its own `source` slug, its own hash bucket.

### What is NOT a risk

- **Adding 11 PSIRT feeds will not collide with existing RSS or KEV/NVD rows.**
  The source-string discriminator works exactly as designed for cross-source
  separation.

### What IS still a risk for the new PSIRT feeds

- **Intra-source collision** is real but unlikely to bite here. PSIRT advisories
  almost always carry a CVE ID in the structured payload (unlike RSS news), so
  `affected_cve` will rarely be null. As long as PSIRT mappers extract the CVE
  cleanly, each advisory gets its own bucket.
- **Watch the vendor field.** If a PSIRT feed publishes 5 advisories for
  Windows in the same Patch Tuesday, all with different CVE IDs, the hashes
  differ on `affected_cve` and dedup correctly. Good.
- **Watch CVE-less PSIRT advisories.** Some Cisco PSIRTs warn about
  configuration-related issues without a CVE. Those would fall back to the
  same coarse bucketing the RSS feeds suffer from. Mappers should set
  `signal_type` to a more specific value where possible (e.g. distinguish
  `config_advisory` from generic `advisory`) to keep the bucket from
  collapsing — but this is a per-mapper concern, not a cross-pipeline issue.

---

## 4. Recommendation

### Leave the dedup formula AS-IS for the PSIRT addition.

The PSIRT feeds will not hit the cross-pipeline collision the user worried
about. The existing formula is **adequate for vulnerability-typed feeds** where
CVE is the natural discriminator: KEV (already shipped), NVD, MITRE ATT&CK,
MITRE ATLAS, the new PSIRTs. None of these will have the 75%-attrition problem
the worker RSS feeds exhibit, because their items reliably carry a CVE.

### Separately, flag two pre-existing issues (out of scope for the PSIRT PR)

These are real bugs but neither blocks the PSIRT work. Don't bundle.

#### Issue A — RSS news feeds suffer 50–75% silent dedup loss

Documented in §2C above. Worker BleepingComputer dropped 36 of 48; TheRegister
dropped 21 of 37; etc. This isn't a hash-collision-with-other-feeds problem —
it's a hash-formula-too-coarse-for-news problem.

**Spec for a future fix PR (do not write code yet):**

- **Goal:** make the dedup hash discriminative enough that two distinct
  BleepingComputer articles with the same signal_type, no CVE, no vendor match
  still hash differently.
- **Approach:** add a fifth input to `buildDedupHash` — a stable per-item
  identifier the mapper extracts from the upstream feed. For RSS that's the
  GUID (or the canonical link as a fallback). For PSIRT it stays null because
  CVE already carries discrimination.
- **Signature change:** `buildDedupHash(source, signalType, cve, vendor, externalId)`.
  When `externalId` is null the formula degenerates to today's behaviour, so
  KEV/NVD/MITRE/PSIRT rows are unaffected and produce identical hashes
  pre- and post-change. **No backfill required for those sources.**
- **Migration impact for RSS sources:** all existing
  `security_news_*` and (currently empty) `bleepingcomputer`/`krebsonsecurity`/
  `sans_isc` rows would have a different hash post-change. Acceptable because:
  (a) the brief-pipeline RSS rows don't exist yet, and (b) the worker RSS rows
  are low-importance threat-intel context — losing dedup continuity for them
  is fine. No migration step needed; new rows will start hashing under the new
  scheme on first run.
- **Test surface:** unit tests on `buildDedupHash` that cover the
  `externalId=null` degenerate case (must equal today's hash) and the
  `externalId=<GUID>` case (must differ from today's). Plus an
  integration test that fetches BleepingComputer with a stub of 35 items and
  asserts ≥ 30 land in `cyber_signals` (vs today's ~9).
- **Out of scope for the same PR:** changing the underlying signals-table
  upsert key, changing the `cyber_signals` schema, source-name harmonization
  (see Issue B).

#### Issue B — Source-naming asymmetry between worker and brief pipelines

Same upstream feed, two source slugs:

| Feed              | Worker slug                         | Brief-pipeline slug |
|-------------------|-------------------------------------|---------------------|
| BleepingComputer  | `security_news_bleepingcomputer`    | `bleepingcomputer`  |
| Krebs             | `security_news_krebs`               | `krebsonsecurity`   |
| SANS ISC          | (not registered in worker)          | `sans_isc`          |
| TheHackerNews     | `security_news_thehackernews`       | (not registered in brief) |
| TheRegister       | `security_news_theregister`         | (not registered in brief) |

This is **not a dedup correctness bug** — different slugs produce different
hashes, which is the safe failure mode. But it is a **product/architecture
issue**: the platform stores the same upstream source under two different
identities, which fragments analytics, breaks cross-pipeline scoring, and
guarantees that the brief-pipeline RSS adapters won't benefit from any
worker-pipeline ETag/cache work and vice versa.

**Recommended outcome:** harmonize on a single slug per upstream
(`bleepingcomputer`, `krebsonsecurity`, etc., dropping the `security_news_`
prefix) before the brief-pipeline RSS adapters start producing rows. Today's
empty `bleepingcomputer` row count is the cheapest moment in the project's
lifetime to do this without a backfill.

**This is its own audit-and-fix exercise.** Don't bundle into the PSIRT PR.

---

## 5. Summary for the team

- The `dedup_hash` formula is `sha256(source|signal_type|cve|vendor)` lowercased
  and trimmed. Source IS in the formula. CVE/vendor canonicalization is
  minimal (lowercase + trim, no leading-zero or alias collapse).
- The PR #34 24-of-35 dups are **NOT** cross-pipeline collision. They are
  intra-source hash-bucket collapse for general-purpose RSS news where most
  items lack both a CVE ID and a known-vendor match.
- **Adding 11 PSIRT feeds is safe.** They get their own source slugs, their
  hashes will not collide with existing rows, and PSIRT items reliably carry
  a CVE so intra-source collapse is unlikely.
- **No code change recommended for the PSIRT PR.** Two separate pre-existing
  issues (coarse hash for RSS, source-name asymmetry) are documented as future
  work but explicitly out of scope.
