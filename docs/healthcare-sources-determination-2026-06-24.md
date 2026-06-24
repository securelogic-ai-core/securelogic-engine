# Healthcare ingestion sources — build determination (2026-06-24)

Scope: backlog items #6 (HHS OCR breach portal) and #7 (FTC / CMS / ONC
regulatory sources). Every endpoint below was ground-truthed with a live fetch
before any decision — no source was wired on assumption.

## Shipped (PR #316, main `ce4fb58c`)

| Source | id | URL | Status |
|--------|----|-----|--------|
| ONC / ASTP (Health IT) | `onc_healthit` | `https://healthit.gov/blog/feed/` | ✅ added — Tier-1 regulatory RSS, 200/RSS, 0 redirects |
| FTC | `ftc_news` | `https://www.ftc.gov/feeds/press-release.xml` | ✅ **fixed** — the registered `/rss/news.xml` now 404s (FTC moved the feed); repointed |

Both flow through the existing RSS adapter → `regulatory_change` → obligation
branch, with the regulatory mapper's relevance filter keeping only
cyber/privacy items. No bespoke code — the least-fragile path. Feed-health
covers them (it is what surfaces a future URL rot, exactly like the FTC 404).

## Not shipped — and why (no fabricated endpoints)

### CMS — no discoverable RSS
The CMS newsroom is a JS-rendered SPA. Every documented/likely feed path 404s
(`/newsroom/rss.xml`, `/blog/rss.xml`, `/feed`, `/newsroom/press-releases/feed`,
the `about-cms/.../rss-feeds` paths, …) and the `/newsroom/rss-feeds` listing
page contains **no** feed `<link>`s. Registering any of these would create a
permanently-failing feed-health entry. CMS needs a different integration:
GovDelivery email subscription, or an HTML scrape of the rendered newsroom.
**Tracked as a separate, non-RSS integration — not buildable as a registry feed.**

### HHS OCR breach portal — not programmatically accessible without live capture
Authoritative source: `https://ocrportal.hhs.gov/ocr/breach/breach_report.jsf`
(redirects to `breach_frontpage.jsf`). Findings:

- The initial HTML (≈13 KB) contains **no breach rows** and **no CSV/export
  link** — only page chrome + a `javax.faces.ViewState` token.
- The data and any CSV export are driven by **Mojarra JSF postbacks**
  (`mojarra.jsfcljs(...)`) whose command component IDs are **auto-generated and
  version-unstable** (`ocrForm:j_idt37`, `j_idt39`, `j_idt51`, `j_idt53`). None
  is labelled csv/export/download.
- `?csv=true` returns the JSF HTML page, not a CSV.
- No authoritative dataset was locatable via the data.gov catalog API from this
  environment (404).

A correct, non-fragile adapter therefore requires **capturing the live
CSV-export request from a real browser session** against the portal:
1. the exact command component id that triggers the export,
2. the full JSF POST body (`javax.faces.source`, `javax.faces.partial.*`, the
   `ocrForm` field set), and
3. the `ViewState` GET→POST handshake.

Building it on the current guessed `j_idt*` IDs would break on the next portal
redeploy and cannot be verified now — precisely the fragility flagged when this
item was first parked. **Deliberately not shipped as guessed scraper code.**

## To build HHS OCR when a healthcare customer needs it
1. Open the portal in a browser, DevTools → Network, click the CSV/export
   control; copy the resulting POST (URL, headers, full form body).
2. Implement `hhsOcrBreachAdapter.ts` as: GET (capture ViewState) → POST
   (captured body, ViewState substituted) → parse CSV → map each breach to a
   `data_breach` `CyberSignalIngestInput` (entity name → vendor branch when it
   matches a tracked vendor; `external_id` = the breach report id).
3. Wire into `briefScheduler.ts` with `recordFeedSuccess/Failure`, exactly like
   the other adapters. Keep it isolated + once-per-run per the original note.
