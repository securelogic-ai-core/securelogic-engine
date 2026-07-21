# Intelligence Events (IE) — Canonical Event Model — Design Memo

**Status:** Ratified for autonomous implementation (Intelligence Pipeline Hardening goal, 2026-07-07).
**Program:** Extends ERIP (Epic 3 — Enterprise Risk Intelligence) on the ingestion side.
**Governing invariants:** everything DARK behind a flag (default off ×all services), additive
migrations only, backward compatibility structural, reuse-before-rewrite, no production
enablement (GATE B), operator actions ledgered never executed.

**New flag:** `SECURELOGIC_INTELLIGENCE_EVENTS_ENABLED` (default `"false"`).

---

## 1. Problem (verified current state)

The external-intelligence pipeline has **no canonical event object**. The `cyber_signals`
row is the unit of intelligence, and it exists in **two uncoordinated partitions**:

- **global** (`organization_id IS NULL`) rows from the hourly worker + 15-min KEV poller;
- **per-org copies** from the weekly brief scheduler (`ingestSignalsForOrg`).

Consequences:
- The same real-world event (a CVE described by CISA KEV + NVD + BleepingComputer, later
  patched, later exploited) is stored as **many independent signal rows**, deduped only
  *within* each `(org, source)` partition. There is no single evolving object.
- `dedup_hash` uses `ON CONFLICT DO NOTHING`, so a **changed** upstream item never updates.
- `cluster_key` (soft corroboration grouping) + `clusterKey()` + the brief-item provenance
  table are **staged but inert** — additive scaffolding that was built for exactly this
  keystone but carries zero runtime weight today.
- `normalized_summary` is **feed text mechanically truncated at 500 chars with `"…"`** — the
  opposite of the goal's "never display broken sentences."
- `findings` INSERT has **no `ON CONFLICT`** → re-firing the matcher creates duplicate findings.
- No timeline. No event-level source-corroboration ledger. No content-quality signal on the event.

## 2. Design decisions

**IE-AD-1 — Canonical event is GLOBAL and PROJECTED, never a new ingestion path.**
`intelligence_events` rows are org-agnostic (like `cyber_signals` global rows: category E,
no org RLS). We do **not** change `dedup_hash`, the two ingestion partitions, or the 13 INSERT
sites. We add a projection *layer above* `cyber_signals`: every signal (global or per-org copy)
that shares a canonical identity projects into **one** event. This preserves backward
compatibility and reuses the entire existing pipeline. Per-org relevance stays where it is
today (the matcher fan-out + the brief's `OR organization_id IS NULL` read); the event layer is
the shared, org-agnostic spine those per-org surfaces cite.

**IE-AD-2 — Identity = a TOTAL promotion of `clusterKey()`.**
`eventCanonicalKey(signal)` is deterministic and total (every signal maps to exactly one event):
1. `clusterKey()` result if non-null (`cve:CVE-…` primary, else `fp:vendor|type|utc-day`);
2. otherwise `sig:<dedup_hash>` — a stable per-signal singleton (no orphans, no over-merge).
The event's `canonical_key` is `UNIQUE`; re-projection of any signal is idempotent and
**update-detecting** (revision bump + timeline entry when severity/status/source-set changes).

**IE-AD-3 — Source corroboration is preserved forever.**
`intelligence_event_sources` — one row per contributing `(event, cyber_signal)`, carrying a
**denormalized** `source`/`external_id` (survives signal purge), `relation`
(`canonical`/`corroborating`), `confidence`, `first_contributed_at`, `last_contributed_at`, and a
`revision` count. Attribution is never lost. `ON DELETE SET NULL` on the signal FK.

**IE-AD-4 — Timeline is append-only and deterministically derived.**
`intelligence_event_timeline` — chronological entries (`first_seen`, `corroborated`,
`new_advisory`, `exploit_activity`, `patch_available`, `severity_change`, `status_change`).
Entries are derived from signal_type + severity transitions; no wall-clock nondeterminism
(the projection takes an injected `at`).

**IE-AD-5 — Content quality gating: never display a broken sentence.**
A pure `contentQuality` classifier detects truncation (trailing `…`/`...`, mid-word/mid-sentence
cut, unbalanced brackets), malformed/empty, and partial content. It returns a **clean display
text** trimmed to the last complete sentence, plus a `status` (`complete`/`truncated`/`degraded`)
and an explicit, human-readable truncation marker only when content was genuinely cut. The event's
`executive_summary` and `summary_status` use it. Raw feed text stays in `raw_payload`/event
sources — never promoted to the primary customer field.

**IE-AD-6 — Executive summary is normalized, never raw.**
Event `executive_summary` is generated: a deterministic, citation-preserving template first
(source list + affected entity + severity + status), optionally enhanced by `llmService` when a
key is present (graceful degradation to the template otherwise — same discipline as the ERIP
raised-bar LLM features). Citations to contributing sources are always preserved.

**IE-AD-7 — Findings from events are dedup-by-update.**
When events feed findings, an event maps to at most one open finding; an evolving event **updates**
its finding (severity/summary/timeline) rather than creating a duplicate. This is the event-layer
fix for the no-`ON CONFLICT` liability; the legacy per-signal matcher path is unchanged (behind
the flag, the event path is additive).

**IE-AD-8 — Downstream consumes events when the flag is on; dark == byte-identical legacy.**
Brief / executive / graph read events only when `SECURELOGIC_INTELLIGENCE_EVENTS_ENABLED` is on.
Default off ⇒ the projection does zero DB work and every downstream surface is unchanged.

**IE-AD-10 — Authoritative 7-state lifecycle (added 2026-07-07).** The canonical event is THE
intelligence model. Its lifecycle — `new → corroborating → confirmed → actively_exploited →
mitigated → resolved → archived` (`intelligenceEventLifecycle.ts`) — is derived deterministically
from accumulated evidence (distinct sources, authoritative sources, `ever_exploited`,
`ever_patched`); `resolved`/`archived` come from a time-based aging pass; a new signal re-activates
an aged event. Every downstream surface migrates to read events (IE-AD-8), each behind the same
flag with byte-identical flag-off behavior:
- **Brief** (`eventBriefSource`) maps events into the existing `CyberSignalForBrief` seam.
- **Executive** (`getExecutiveEventSummary`) + **API/UI** (enriched `/events/:id`: lifecycle,
  timeline, sources+citations, confidence, related findings, affected assets, recommended actions).
- **Graph ask** (`eventGraphContext`) supplies neighbourhood events as citable LLM evidence.
- **Predictive** (`eventHistorySeries`) forecasts event-level timeline counts, not signal spikes.
- **Workflow** (`processEventLifecycleTriggers`) fires per-org findings + notifications ONCE per
  event lifecycle transition (dedup ledger), not per raw signal.

**IE-AD-11 — Event-native matcher-linkage layer (added 2026-07-07).** Raw `cyber_signal` is no
longer part of any customer-facing intelligence workflow; it remains the INGESTION RECORD only
(ingestion, forensics, debugging). The bridge is `eventSignalResolver.ts`
(cyber_signal_id → event via the corroboration ledger, CVE canonical-key fallback):
- **Matcher** stamps `signal_match_suggestions.intelligence_event_id` (migration `20260826`,
  additive nullable FK; `signal_id` preserved for compat/forensics) after emitting suggestions —
  so the **accept/dismiss workflow** and every **linkage service** (vendor / AI system /
  application / asset / control / obligation) reference the canonical event. Projection runs
  BEFORE the matcher fan-out so the event exists at match time.
- **Link-list endpoints** resolve each linked signal through the ledger to the event and display
  the normalized `event_summary` (COALESCE over raw), lifecycle, confidence, canonical_key.
- **`vendorSignalContext`, `/intelligence` recent feed, `POST /intelligence-briefs/generate`**
  source from canonical events when the flag is on; legacy raw query when off.
- **Exempt (by design):** `cyberSignals.ts` (ingestion + raw forensics/debug list), the
  `SELECT 1 FROM cyber_signals` existence checks (link/accept integrity validation), and every
  flag-off legacy branch. Ingestion is unchanged.

**IE-AD-9 — Notification policy replaces event-per-email.**
Immediate alert **only** for customer-impacting *critical* events (deduped via a notification
ledger keyed by event + org + channel); the daily digest summarizes events + org risk changes;
the weekly executive summary remains separate. No duplicate notifications.

## 3. Schema (additive, global, category E, no org RLS)

- `intelligence_events` — canonical_key UNIQUE, title, event_type, severity, status,
  executive_summary, summary_status, affected_cve, affected_vendor, source_count, confidence,
  first_seen_at, last_seen_at, revision, timestamps.
- `intelligence_event_sources` — event_id, cyber_signal_id (SET NULL), source, external_id,
  relation, confidence, first/last_contributed_at, revision; UNIQUE(event_id, cyber_signal_id).
- `intelligence_event_timeline` — event_id, entry_type, occurred_at, summary, source,
  cyber_signal_id, metadata.

All three are GLOBAL operational/intel tables: `rlsStatus: "none"`, registered in
`dataClassification.ts`. Reversible by `DROP TABLE`.

## 4. Slice plan

- **IE.P0** — this memo + tracker + flag declaration. (docs + render.yaml)
- **IE.P1** — `intelligenceEventIdentity.ts` (pure total identity) + tests.
- **IE.P2** — `contentQuality.ts` (pure truncation/malformed detection + clean display) + tests.
- **IE.P3** — migration (3 tables) + `intelligenceEventProjection.ts` (pure upsert/timeline plan) + tests.
- **IE.P4** — `intelligenceEventStore.ts` (persist plan, global/elevated) + dark projection entrypoint + backfill + isolation test.
- **IE.P5** — `eventExecutiveSummary.ts` (deterministic + LLM-enhanced, citation-preserving) + tests.
- **IE.P6** — event→finding dedup-by-update + isolation test.
- **IE.P7** — downstream reads (brief/exec) + notification policy + ledger + tests.

## 5. Rollback

Every slice is additive + dark. Flag off ⇒ inert. Full rollback: set the flag off (already the
default) and, if desired, `DROP TABLE intelligence_event_timeline, intelligence_event_sources,
intelligence_events;`. No legacy path is modified, so removing the epic restores the exact
pre-epic pipeline.

## 6. Operator-owned (ledgered, never executed here)

- Staging validation of the projection with the flag on.
- Production enablement of `SECURELOGIC_INTELLIGENCE_EVENTS_ENABLED` (GATE B).
- Running the event backfill in staging/prod.
- Any real-credential / outbound-notification enablement.
