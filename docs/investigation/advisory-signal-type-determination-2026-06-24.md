# Advisory signal-type "producer" — determination (2026-06-24)

## Question
Goal item 14: *"Advisory signal-type producer (wiring bug — no live producer)."*
Is the `'advisory'` cyber-signal type an orphaned/broken type with no producer, and
does it need a code fix?

## Finding — NOT a wiring bug

`'advisory'` is a fully-wired, end-to-end-supported signal type. The "no live
producer" framing is imprecise: there is no *automated adapter* that emits it,
but the *manual / API ingest path is a live producer*, by design.

### Producers
- **Manual / API ingest — LIVE.** `'advisory'` is a member of `VALID_SIGNAL_TYPES`
  (`src/api/lib/cyberSignalValidation.ts:51`), which `validateCyberSignalIngest`
  enforces. `POST /api/cyber-signals` (`src/api/routes/cyberSignals.ts:163`) runs
  exactly that validator, so any operator/API client can ingest an `'advisory'`
  signal today. This is a real, wired producer.
- **Automated adapters — intentionally use the more-specific `'patch_advisory'`.**
  `cisaAlertsAdapter` and `feedAdapter/threatIntelHelpers` derive advisory-shaped
  feed items to `'patch_advisory'` ("vendor security advisory not tied to a
  specific CVE", `cyberSignalValidation.ts:60`), never the generic `'advisory'`.
  This is deliberate granularity, documented in those adapters.

### Consumers — all handle `'advisory'` correctly
- `cyberSignalProcessingService.ts:155` — routes `'advisory'` to the
  **"Vulnerability"** risk lane (alongside cve/patch/malware/threat_actor).
- `intelligenceBriefGenerator.ts:225` — maps `'advisory'` → `vulnerability`
  presentation bucket.
- `llmControlMatcher.ts` `CONTROL_RELEVANT_SIGNAL_TYPES` — includes `'advisory'`,
  so a manually-ingested advisory is eligible for LLM control matching.

## Conclusion
No code change is warranted. `'advisory'` is a valid, consumed generic type with a
live manual/API producer; the automated pipeline correctly prefers the more-specific
`'patch_advisory'`. There is no broken wiring to repair.

## If automated advisory sourcing is later desired (product decision, not a bug)
Adding an *automated* `'advisory'` producer is a taxonomy/product choice, not a
defect fix. Two clean options, either explicitly chosen — do **not** silently
re-route existing `'patch_advisory'` emitters:
1. **Source-mapped:** point a specific feed (e.g. CISA security advisories distinct
   from patch/ICS bulletins) at `'advisory'`, with its own derivation rule in the
   relevant adapter. Requires deciding which source's items are "generic advisory"
   vs. the existing `'patch_advisory'`.
2. **Collapse the type:** if `'advisory'` and `'patch_advisory'` are not meaningfully
   distinct for the product, deprecate one — a migration + validator + consumer
   sweep — rather than leaving two near-synonyms. Higher blast radius; only if the
   distinction is confirmed valueless.

Item 14 is resolved as **investigated, not-a-bug, no change**. Any future automated
advisory sourcing should be raised as a taxonomy decision with one of the above.
