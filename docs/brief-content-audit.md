# Intelligence Brief content-quality audit

**Date:** 2026-05-02
**Branch:** develop (audit findings only — no code changes)
**Trigger:** Customer-zero (org `fe2ede61…`) iPad screenshots showed every card
tagged "THREAT_ACTOR", repeated CVEs across cards, no CVSS/KEV badges, and raw
internal source slugs (`regulatory_cisa`, `security_news_bleepingcomputer`).
This audit traces each bug end-to-end and proposes a fix order.

**Note on empirical evidence:** the dedup audit (PR #39) ran SQL directly on
staging. This investigation has no staging-DB credentials available in the
codespace; the SQL queries that ground each finding are listed in §6 for the
user to run against staging to confirm the magnitudes.

---

## 1. Bug 1 — Every card tagged "THREAT_ACTOR"

### Symptom
> "Every card in a recent brief was tagged THREAT_ACTOR regardless of actual
> content (some cards were CVEs, some were policy news, some were vendor
> advisories)."

### Root cause — coarse keyword classifier in worker, NOT in the brief generator or frontend

The categorization chain has four hops. Bug is at hop 1.

| Hop | File:line | What it does |
|----|----|----|
| 1. **Worker classifier** | `services/intelligence-worker/src/pipeline/classifyCategory.ts:9-53` | Picks `primary` category from 5 keyword regexes. **First match wins.** First regex tested is `SECURITY_INCIDENT` matching `cve\|zero-day\|exploit\|breach\|ransomware\|malware\|phishing\|attack\|trojan\|cybercrime`. |
| 2. **Worker bridge** | `services/intelligence-worker/src/pipeline/runPipeline.ts:49-56` | `CATEGORY_TO_SIGNAL_TYPE` maps `SECURITY_INCIDENT` → `signal_type='threat_actor'` and writes the row to `cyber_signals`. |
| 3. **Brief generator** | `src/api/lib/intelligenceBriefGenerator.ts:176-207` | `mapSignalToCategory("threat_actor")` returns `category='threat_actor'` — by design. Also **silently dropped:** `signal_type='vulnerability'` (used by MITRE ATT&CK technique rows; `cyberSignalValidation.ts:58`) is not in the switch and falls to the `default: "general"` case. |
| 4. **Frontend** | `app/src/components/IntelligenceBriefSignalCard.tsx:40-50` | `CATEGORY_LABELS` dictionary maps `threat_actor → "Threat Actor"`. CSS `uppercase` class on the chip span (`line:117`) renders this as **"THREAT ACTOR"**. The customer's "THREAT_ACTOR" with underscore is most likely the chip rendered with a space (a transcription artifact); even if literally an underscore, the only way that renders is `categoryLabel(item.category)` falling through to `?? category` (line 49) on an unknown value — which would happen if a future code path emits a category outside the 5 known keys. **Frontend is NOT the bug.** It correctly renders whatever the backend sends.

The customer's complaint resolves at hop 1.

### Why the SECURITY_INCIDENT bucket gobbles everything

The first regex matches **any** of:
`cve | zero-day | exploit | breach | ransomware | malware | phishing | attack | trojan | cybercrime`

Almost every cybersecurity headline contains one of those words. A regulatory
article saying "...new breach-notification rule..." matches `breach`. A vendor
advisory saying "...patch this vulnerability before exploit..." matches
`exploit`. A CVE article matches `cve`. There is no precedence for vulnerability
or regulation; `SECURITY_INCIDENT` is just first in the if-chain
(`classifyCategory.ts:15`).

For all four `security_news_*` RSS feeds (BleepingComputer, Krebs, HackerNews,
TheRegister, ~50 articles/day) and parts of the AI-governance feed, this
classifier reliably tags them `SECURITY_INCIDENT`. The bridge then converts
those to `signal_type='threat_actor'`. The brief generator faithfully buckets
them as category `threat_actor`. The customer sees a brief where a CVE article,
a Cisco advisory, a NIST guidance update, and a SaaS breach all show up under
the same category label.

### Distinguishing OUR code vs the prompt

There is no Claude prompt involvement in category assignment. Categories are
assigned deterministically by:
- `classifyCategory.ts:9-53` (worker, keyword regex)
- `runPipeline.ts:49-56` (worker, static map)
- `mapSignalToCategory` in `intelligenceBriefGenerator.ts:176-207` (engine,
  switch statement)

Synthesis (`briefSynthesizer.ts`) only generates `headline` / `teaser` /
`exec_summary`. Per-item enrichment (`enrichItemWithClaude`) only generates
`analysis`, `why_it_matters`, `recommended_actions`, `urgency` — it never
touches `category`. **Category is 100% deterministic, OUR code, no LLM.**

### Fix scope

**Local — single file, ~40 lines.** The cleanest fix lives in
`classifyCategory.ts`. Two changes:

1. Add a high-precedence `VULNERABILITY` bucket that fires when the title
   contains a CVE-ID or a tight vulnerability vocabulary (`vulnerability`,
   `patch`, `CVE-`, `advisory`, `RCE`, `privilege escalation`).
2. Reorder the if-chain so specific buckets (`VULNERABILITY`, `REGULATION`,
   `AI_GOVERNANCE`) come BEFORE the broad `SECURITY_INCIDENT` net. Tighten the
   `SECURITY_INCIDENT` keywords to ones that actually identify campaign / actor
   / incident content (`ransomware`, `APT`, `threat actor`, `nation-state`,
   `data breach` — drop the word "attack" alone, which appears in every
   security headline).

Then add a corresponding entry to `CATEGORY_TO_SIGNAL_TYPE` in `runPipeline.ts`:
`VULNERABILITY: "patch_advisory"`. The brief generator's existing mapping
already routes `patch_advisory` → `category='vulnerability'`.

Also worth fixing in the same PR (cheap and load-bearing):
`mapSignalToCategory` in `intelligenceBriefGenerator.ts:176-207` should add a
case for `signal_type='vulnerability'` → `category='vulnerability'` so MITRE
ATT&CK techniques don't fall to `general`.

### Frontend involvement
**No.** Frontend renders whatever the backend stamps.

### Migration
**No.** All five values (`vulnerability`, `threat_actor`, `vendor_incident`,
`regulatory`, `general`) are already accepted by the
`intelligence_brief_items_category_check` constraint
(`db/migrations/20260506_brief_items_regulatory_category.sql:18-26`).

### Estimated PRs
**1 PR.** Touches:
- `services/intelligence-worker/src/pipeline/classifyCategory.ts`
- `services/intelligence-worker/src/pipeline/runPipeline.ts`
- `src/api/lib/intelligenceBriefGenerator.ts` (one-line add for `vulnerability`
  signal_type)
- Tests covering: a CVE headline → `vulnerability`, a NIST headline →
  `regulatory`, a ransomware headline → `threat_actor`, an "AI Act" headline →
  the AI bucket. Important regression to add: confirm a "ransomware breach"
  headline doesn't also match `VULNERABILITY` first.

### Dependencies
**Independent.** Doesn't block or unblock any other bug fix.

---

## 2. Bug 2 — Same CVE appearing in multiple cards

### Symptom
> "CVE-2024-XXXXX shows up as a standalone card AND as part of a vendor
> advisory card AND in a threat-roundup card. The user reads about it three
> times in one brief."

### Root cause — no CVE-level dedup at brief-item assembly

`buildBriefItems` in `intelligenceBriefGenerator.ts:256-286` is a 1:1 map from
`cyber_signals` rows to `BriefItem` rows. There is no merge step.

The `cyber_signals` table itself dedups within `(source, signal_type,
affected_cve, affected_vendor)` (PR #39 audit). That prevents the *same source*
from re-ingesting the same CVE — but it does nothing about the same CVE being
ingested across multiple sources by design:

| Source | What it produces for CVE-2024-X |
|----|----|
| `cisa_kev` | `signal_type='cve'`, vendor=Microsoft, severity=Critical |
| `nvd` | `signal_type='cve'`, vendor=Microsoft, severity=High |
| `cisa_alerts` | `signal_type='patch_advisory'`, vendor=Microsoft |
| `security_news_bleepingcomputer` | `signal_type='threat_actor'`, vendor=Microsoft, CVE extracted from title |
| `mitre_attack` | `signal_type='threat_actor'`, no CVE (technique-level) |

Comment on `db/migrations/20260430_cyber_signals_ingestion.sql:30-31`:
> "Two adapters (CISA and NVD) reporting the same CVE from the same source
> are considered distinct signals (different source in hash)."

This is correct as a *signal-store* design (preserve provenance). It is wrong
as a *brief* design (the user wants one card per CVE). Currently the brief
faithfully renders all four+ rows.

The brief generator route runs the SQL in `intelligenceBriefs.ts:162-179` —
which selects everything in the window, `ORDER BY ingestion_timestamp DESC`,
no `DISTINCT ON (affected_cve)`. Then `buildBriefItems` builds one item per
row.

### Fix scope

**Local — single file, ~30 lines.** Add a CVE-merge step in
`buildBriefItems`. Algorithm:

1. Partition signals into two pools: CVE-bearing (`affected_cve` non-null) and
   CVE-less.
2. Group CVE-bearing signals by uppercase `affected_cve`.
3. For each group, pick a canonical signal using a fixed source-priority
   ladder: `cisa_kev > nvd > cisa_alerts > psirt_* > security_news_*`. KEV
   wins because it carries the federal due-date and known-exploitation flag.
   Promote that one to a `BriefItem`. Discard the rest of the group; optionally
   stash their `source` slugs into a `corroborating_sources` array on the item
   (this maps to the badge work in §3 — it's the data the user needs to see
   "this is corroborated by N sources").
4. CVE-less signals pass through unchanged (one item per signal).

This is a pure-function change. No DB changes. No prompt changes.

Edge cases to handle in the fix:
- A CVE appears in a `mitre_attack` technique row (CVE-less most of the time
  but some have CVE references in `external_references`) — those land in the
  CVE-less pool, which is fine.
- Vendor-bridged signals (`security_news_bleepingcomputer`) where `affected_cve`
  was extracted from the title — these correctly join the CVE pool and get
  deduped against KEV. Net: the BleepingComputer "Microsoft patches CVE-X"
  article is dropped in favour of the KEV entry, which is what the user wants.

### Frontend involvement
**No** for the dedup fix itself. **Optional yes** if we want to render
"corroborated by 3 sources" — that needs a small UI addition (a stack of
source-pills under the title, or a "+2 more" hover). Worth adding because it
preserves the "many sources are talking about this" signal that the customer
might actually value, while removing the visual repetition.

### Migration
**No.**

### Estimated PRs
**1 PR.** Could be 2 if we want corroboration UI as its own slice, but that's
optional polish.

### Dependencies
**Independent.** No order constraint with bug 1, but **fixing bug 2 first
amplifies the visible impact of bug 1's fix** — once duplicate CVE cards are
gone, the residual diversity of categories becomes obvious, and a poor
classifier becomes more obviously wrong. There's an argument for fixing bug 1
first so that when bug 2 ships, the surviving cards are already well-categorized.

---

## 3. Bug 3 — Missing CVSS, KEV, "actively exploited" badges

### Symptom
> "Cards don't surface CVSS score, 'actively exploited' (KEV) flag, or any
> other risk-tier indicator. The user can't tell at a glance whether a CVE is
> critical or low-severity."

### Root cause — data exists in `cyber_signals.raw_payload` but is never lifted into the brief

This is a structural problem, not a missing-render problem.

#### Trace: where the data gets lost

| Stage | File:line | Has CVSS / KEV data? |
|----|----|----|
| KEV adapter writes signal | `cisaKevAdapter.ts:162-170` | ✅ Yes — full KEV entry written verbatim into `raw_payload` (includes `cvssScore`, `dateAdded`, `dueDate`, `knownRansomwareCampaignUse`, `requiredAction`, `vulnerabilityName`). |
| NVD adapter writes signal | `nvdAdapter.ts:345-353` | ✅ Yes — full NVD CVE object in `raw_payload` (includes `metrics.cvssMetricV31[*].cvssData.baseScore`). |
| `cyber_signals` table schema | `db/migrations/20260430_cyber_signals_ingestion.sql:36-85` | Partial — `severity` (string: Critical/High/Moderate/Low) is structured, but **no `cvss_score`, `kev_listed`, `exploited`, `due_date` columns**. The CVSS and KEV-listed status live only inside `raw_payload` (JSONB). |
| Brief generator pulls signals | `intelligenceBriefs.ts:163-179` | ✅ Yes — `raw_payload` is in the SELECT list (line 172). |
| `CyberSignalForBrief` type | `intelligenceBriefGenerator.ts:68-85` | ✅ Yes — `raw_payload` is in the type. |
| `buildBriefItems` reads it | `intelligenceBriefGenerator.ts:259-272` and `buildItemTitle` (lines 317-341) | ⚠️ Reads `raw_payload.title` only. Drops everything else on the floor. |
| `BriefItem` type | `intelligenceBriefGenerator.ts:87-116` | ❌ **No `cvss_score`, no `kev_listed`, no `exploitation_status`, no `due_date` fields.** Severity (string) is the only risk-tier signal available. |
| `intelligence_brief_items` schema | `db/migrations/20260501_intelligence_brief_pipeline.sql:83-106` | ❌ **No badge columns.** |
| GET API response | `intelligenceBriefs.ts:856-916` | ❌ Doesn't return them — can't, they're not in the row. |
| Frontend card | `IntelligenceBriefSignalCard.tsx:1-182` | ❌ Doesn't render them. Severity pill (lines 56-62) shows the `relevance` enum, not the actual CVSS number. |

So the data is **available at the brief-generator boundary** (in
`raw_payload`) but is dropped by `buildBriefItems`, never persisted to
`intelligence_brief_items`, never returned by the API, never seen by the frontend.

#### What badges the customer needs and where the source-of-truth is

| Badge | Source field | Source-of-truth |
|----|----|----|
| CVSS score (e.g. "9.8") | `raw_payload.cvssScore` | `cisa_kev` rows; on `nvd` rows it's at `raw_payload.metrics.cvssMetricV31[*].cvssData.baseScore` (path varies by CVSS version — V31, V40). |
| KEV-listed | derivable from `source = 'cisa_kev'` | All KEV rows are KEV-listed. |
| Active ransomware use | `raw_payload.knownRansomwareCampaignUse` | KEV-only (NVD doesn't track this). |
| Federal due date | `raw_payload.dueDate` | KEV-only. |

### Distinguishing OUR code vs the prompt

No prompt involvement. Badges are a structured-data problem end-to-end.

### Fix scope

**Structural — multiple files, two layers of change.**

**Layer 1 (backend, required):**
- Extend `BriefItem` type with optional `cvss_score: number | null`,
  `kev_listed: boolean`, `actively_exploited: boolean`, `due_date: string | null`.
- Extract these from `raw_payload` inside `buildBriefItems`. The CVSS-extraction
  helper needs to handle four shapes: (a) `cvssScore` flat (KEV); (b) `metrics.cvssMetricV31[].cvssData.baseScore`
  (NVD V3.1); (c) `metrics.cvssMetricV40[].cvssData.baseScore` (NVD V4.0);
  (d) absent (RSS news, MITRE techniques, regulatory). Helper returns `null`
  on (d).
- KEV-listed: `source === 'cisa_kev'`.
- Actively exploited: `source === 'cisa_kev'` (every KEV row is by definition
  exploited in the wild) OR `raw_payload.knownRansomwareCampaignUse === 'Known'`.
- Persist these fields onto `intelligence_brief_items` (DB migration adding 4
  columns).
- Surface them in the GET response and the items-array shape in
  `intelligenceBriefs.ts:856-916`.

**Layer 2 (frontend, required):**
- Add badge row to `IntelligenceBriefSignalCard.tsx` between line 124 and 127
  (between the priority band and the body): a horizontal flex of small pills:
  `CVSS 9.8` (color-tiered), `KEV` (red), `RANSOMWARE` (orange when
  `knownRansomwareCampaignUse`), `DUE 2026-05-30` (when due date present).
- Mirror the badges on the detail page
  (`app/src/app/briefs/[id]/signal/item/[index]/page.tsx`) inside the
  source block (currently lines 300-332).

**Layer 3 (optional but worth considering):**
Promote `cvss_score`, `kev_listed`, `actively_exploited`, `due_date` onto
`cyber_signals` itself (new columns + adapter writes them at ingest time).
This is more invasive but pays dividends for any future surface that needs
this data (vendor-risk dashboards, the action-prioritization engine, posture
scoring) without re-parsing `raw_payload` every time. **Recommend deferring
this to a follow-up PR.** The brief-only fix (layers 1 + 2) ships value
sooner.

### Frontend involvement
**Yes.** Both the card component and the detail page need badge rendering.

### Migration
**Yes.** New migration adding `cvss_score NUMERIC(3,1)`,
`kev_listed BOOLEAN`, `actively_exploited BOOLEAN`, `due_date DATE` to
`intelligence_brief_items`. New briefs populate them; existing briefs leave
them null (frontend hides badges where data is null — graceful degradation).

### Estimated PRs
**2 PRs in sequence.** PR-A backend (type + extraction + DB migration + GET
response). PR-B frontend (render badges). PR-A must merge first so PR-B has
real data to render.

### Dependencies
- **Strong dependency on bug 2.** Fixing badges before CVE dedup means each
  duplicate card still gets its own badges, multiplying the visual noise.
  After CVE dedup, the surviving canonical card carries the badges that
  matter (KEV's CVSS + due date). **Bug 2 should ship first.**
- Loose dependency on bug 1 — categories don't affect badges directly, but a
  badge row makes a mis-categorized card more obviously wrong (a CVSS-9.8
  badge inside a "Threat Actor" category is jarring). Fixing bug 1 before
  ship doesn't gate the work, just improves the demo.

---

## 4. Bug 4 — Internal source slugs leaking to UI

### Symptom
> "The user-visible 'source' field shows 'regulatory_cisa' or
> 'security_news_bleepingcomputer' instead of 'CISA' or 'BleepingComputer.'"

### Root cause — no display-name mapping anywhere in the codebase

There is literally no `slug → display name` mapping in the repo. Verified via
exhaustive grep across `src/`, `services/`, and `app/src/` for `displayName`,
`sourceLabel`, `humanReadable`, `SOURCE_NAMES`, `prettySource`, `formatSource`,
etc. The only display-name concept that exists is `planDisplayName`
(unrelated — for billing tiers).

The data flow is:

| Stage | File:line |
|----|----|
| Adapter / worker stamps `source` slug | `cisaKevAdapter.ts:163` (`source: "cisa_kev"`), `cisaAlertsAdapter.ts:217` (`source: "cisa_alerts"`), worker bridge `runPipeline.ts:122` (passes through), worker source feeds (`securityNewsFeed.ts:22-30`, `regulatoryFeed.ts:22-26`, etc.). |
| `cyber_signals.source` column | TEXT, no CHECK constraint (`db/migrations/20260430_cyber_signals_ingestion.sql:44`). |
| Brief generator copies it | `intelligenceBriefGenerator.ts:267` — `source_slug: s.source` (verbatim). |
| `intelligence_brief_items.source_slug` | TEXT (no constraint). |
| GET API returns it | `intelligenceBriefs.ts:906` — `source_slug: item.source_slug` (verbatim). |
| Frontend renders raw slug | `app/src/app/briefs/[id]/signal/item/[index]/page.tsx:321` — `<dd className="text-slate-300">{item.source_slug}</dd>`. **No translation.** |

#### Inventory of slugs the user might see (22 distinct)

**Engine adapters (consistent, snake_case, source-of-truth):**
`cisa_kev`, `cisa_alerts`, `nvd`, `mitre_attack`, `mitre_atlas`,
`bleepingcomputer`, `krebsonsecurity`, `sans_isc`, `nist_news`, `ftc_news`.

**Worker bridge (prefixed, asymmetric — see deferred Issue B in
`docs/dedup-audit.md`):**
`security_news_thehackernews`, `security_news_bleepingcomputer`,
`security_news_krebs`, `security_news_theregister`,
`vendor_risk_securityweek`, `vendor_risk_darkreading`,
`regulatory_cisa`, `regulatory_nist`, `regulatory_ftc`, `regulatory_sec_8k`,
`regulatory_nydfs`, `regulatory_enisa`, `regulatory_ico`, `regulatory_fsb`,
`ai_governance_venturebeat`, `ai_governance_mit_techreview`.

The customer's "regulatory_cisa" and "security_news_bleepingcomputer" both come
from the worker side. Engine-side rows would already render as
`bleepingcomputer` (still ugly, just less ugly).

### Distinguishing OUR code vs the prompt

No prompt involvement. Source label is structured data.

### Fix scope

**Local — single file plus one consumer, ~50 lines total.**

Create `src/api/lib/sourceDisplayNames.ts` (or similar) with a single object:

```ts
export const SOURCE_DISPLAY_NAMES: Record<string, string> = {
  cisa_kev: "CISA KEV",
  cisa_alerts: "CISA",
  nvd: "NVD",
  mitre_attack: "MITRE ATT&CK",
  mitre_atlas: "MITRE ATLAS",
  bleepingcomputer: "BleepingComputer",
  krebsonsecurity: "Krebs on Security",
  // ... 22 entries total
};

export function sourceDisplayName(slug: string): string {
  return SOURCE_DISPLAY_NAMES[slug] ?? slug;
}
```

Then either:

**Option A (recommended):** add `source_display: string` to the GET response
in `intelligenceBriefs.ts:906`, computed via `sourceDisplayName(item.source_slug)`.
Frontend renders `item.source_display` at
`app/src/app/briefs/[id]/signal/item/[index]/page.tsx:321`. Backend stays the
single source of truth for the mapping; frontend stays dumb.

**Option B:** ship the mapping into the frontend as a constant. Slightly
faster to deploy but means a Slack-channel renaming requires a frontend
release. Option A is cleaner.

This work is closely related to deferred **Issue B** in
`docs/dedup-audit.md`: harmonizing the worker prefixed slugs
(`security_news_bleepingcomputer`) onto the engine canonical
(`bleepingcomputer`). Two ways forward:

1. **Ship bug-4 first, fix Issue B later.** Cover the prefixed slugs in
   `SOURCE_DISPLAY_NAMES` (`security_news_bleepingcomputer: "BleepingComputer"`,
   `regulatory_cisa: "CISA"`, etc.) so customers stop seeing slugs immediately;
   harmonize the slug strings later as a separate refactor.
2. **Fix Issue B first, then bug 4.** Drop the prefixes at write time so
   there's only one slug per upstream source. Then `SOURCE_DISPLAY_NAMES`
   needs ~10 entries instead of ~22.

Recommend **option 1** — bug 4 is a customer-visible bug that should ship
fast; harmonization is a deferred refactor with no fixed deadline.

### Frontend involvement
**Yes if we go option B; minimal yes if we go option A** (one-character
change: render `source_display` instead of `source_slug`).

### Migration
**No.**

### Estimated PRs
**1 PR.** Can be a small one if scoped to the visible-on-card surface only.

### Dependencies
**Independent.** Fastest "small visible win" of the four bugs. Could ship
same-day.

---

## 5. Recommended fix order

### Tier 1 — ship this week (high payoff, low cost)

1. **Bug 4 (source names) — ship first.** Smallest PR, no migration, no
   frontend logic, immediate visible win. Removes one of the four "this looks
   unfinished" signals on every card. Half a day of work.

2. **Bug 1 (categorization) — ship second.** Single-file logic change in the
   worker classifier. No migration, no frontend involvement, no LLM dependency.
   The hardest part is calibrating the new keyword regexes against real
   headlines, which is testable offline with the staging brief's signal corpus.
   One day of work plus a careful review.

### Tier 2 — ship next, in this order

3. **Bug 2 (CVE dedup) — ship third.** One-file logic change. Must come before
   bug 3 because badges on duplicate cards multiply the visual noise. If we
   add corroboration UI ("seen in 3 sources"), that's optional follow-up.
   One day plus tests.

4. **Bug 3 (badges) — ship last.** Highest user-visible payoff per surface
   element, but also the most expensive: backend extraction, DB migration,
   GET response shape change, frontend rendering. Two-PR sequence (backend
   then frontend). Three to four days total.

### What "fixes others for free"

- **Bug 1 fix slightly improves the situation behind bug 2.** A CVE article
  that was previously categorized as `threat_actor` and a KEV row for the
  same CVE that was categorized as `vulnerability` were two cards in different
  categories, both surviving the brief. After bug-1 the news article gets the
  right category (`vulnerability`), making the duplicate land in the same
  bucket — which is then trivially merged by bug-2's CVE-dedup pass. So
  bugs 1 and 2 are mutually reinforcing.

- **Bug 2 fix dramatically reduces the cost of bug 3.** Without dedup, every
  duplicate card needs its own badges. With dedup, badges only render on the
  surviving canonical card.

- **Bug 4 is orthogonal** and doesn't help or hurt the others. Just ship it
  early because it's free.

### What can ship in parallel

- Bug 4 and bug 1 can be done by different engineers in parallel — they touch
  unrelated files (worker classifier vs source-display mapping).
- Bug 3 backend can begin while bug 2 is in review, but should not merge
  before bug 2 ships.

### What this audit is NOT addressing

- Out of scope: re-litigating whether the four-feed worker pipeline should be
  collapsed into the engine's FeedAdapter framework (a structural cleanup
  related to deferred Issue B). The four bugs above can ship without that
  refactor.
- Out of scope: rewriting the per-item Claude prompt
  (`intelligenceBriefGenerator.ts:540-688`). The customer's complaints are
  all about structured-data hygiene, not prose quality.
- Out of scope: changing the brief-level synthesis prompts
  (`briefSynthesizer.ts`). Same reason.

---

## 6. SQL queries for empirical grounding (run on staging)

These were not run during this audit — staging credentials are not present in
the codespace. Run them against staging to confirm magnitudes before scoping
the PRs.

```sql
-- Customer-zero's most recent brief (org fe2ede61…)
SELECT id, period_start, period_end, status, signal_count, item_count,
       generated_at, published_at
FROM intelligence_briefs
WHERE organization_id::text LIKE 'fe2ede61%'
ORDER BY generated_at DESC NULLS LAST
LIMIT 5;
```

```sql
-- Bug 1 evidence: category distribution in that brief
SELECT category, COUNT(*) AS items
FROM intelligence_brief_items
WHERE brief_id = '<brief_id_from_query_above>'
GROUP BY category
ORDER BY items DESC;
-- Expect: 'threat_actor' to dominate.
```

```sql
-- Bug 1 root cause: signal_type distribution in the source rows
SELECT signal_type, COUNT(*) AS rows
FROM cyber_signals
WHERE ingestion_timestamp >= NOW() - INTERVAL '7 days'
  AND (organization_id::text LIKE 'fe2ede61%' OR organization_id IS NULL)
GROUP BY signal_type
ORDER BY rows DESC;
-- Expect: 'threat_actor' to dominate. If so, confirms the worker
-- classifier is the upstream cause.
```

```sql
-- Bug 2 evidence: CVE duplication within the brief
SELECT affected_cve, COUNT(*) AS card_count,
       array_agg(DISTINCT source_slug) AS sources
FROM intelligence_brief_items
WHERE brief_id = '<brief_id>'
  AND affected_cve IS NOT NULL
GROUP BY affected_cve
HAVING COUNT(*) > 1
ORDER BY card_count DESC
LIMIT 10;
-- Each row in the output is a CVE the user is reading about more than once.
```

```sql
-- Bug 3 evidence: how much CVSS data is reachable from the brief's source signals
SELECT
  source,
  COUNT(*) AS rows,
  COUNT(*) FILTER (WHERE raw_payload ? 'cvssScore') AS has_cvss_kev_field,
  COUNT(*) FILTER (WHERE raw_payload #> '{metrics,cvssMetricV31}' IS NOT NULL) AS has_cvss_nvd_v31,
  COUNT(*) FILTER (WHERE raw_payload ? 'knownRansomwareCampaignUse') AS has_ransomware_flag
FROM cyber_signals
WHERE ingestion_timestamp >= NOW() - INTERVAL '7 days'
GROUP BY source
ORDER BY rows DESC;
-- Tells us how many of the brief's items COULD have a CVSS badge if the
-- pipeline extracted the data. Expect cisa_kev rows to have ~100% coverage,
-- nvd rows ~95%, news/mitre rows 0%.
```

```sql
-- Bug 4 evidence: distinct source slugs surfacing on cards
SELECT source_slug, COUNT(*) AS items
FROM intelligence_brief_items
WHERE brief_id = '<brief_id>'
GROUP BY source_slug
ORDER BY items DESC;
-- Each ugly slug here is a string the customer is staring at.
```

---

## 7. Summary

| Bug | Where | Local or structural | Frontend | Migration | PRs | Hot path? |
|---|---|---|---|---|---|---|
| 1. Categorization | `classifyCategory.ts:9-53` (worker keyword regex) | Local | No | No | 1 | Yes |
| 2. CVE dedup | `intelligenceBriefGenerator.ts:256-286` (no merge step) | Local | Optional (corroboration UI) | No | 1 (2 with UI polish) | Yes |
| 3. Badges | Adapter → BriefItem → DB → API → frontend (every layer drops it) | Structural | Yes | Yes | 2 | Yes |
| 4. Source names | No mapping exists; raw slug rendered | Local | One-char render change | No | 1 | Yes |

None of the four bugs are LLM/prompt issues. All are deterministic-pipeline
issues. All are fixable.

Recommended order: **4 → 1 → 2 → 3.**
