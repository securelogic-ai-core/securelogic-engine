# Vendor-Assurance CUEC Matcher — design

**Package:** `vendor-assurance-cuec-matcher` (Package 2 — builds on `vendor-assurance-document-presentation`).
**Status:** built on `develop`; engine + app; one migration `db/migrations/20260613_vendor_assurance_cuecs.sql`; backfill script `scripts/backfill-vendor-assurance-cuecs.ts`.

Promotes the SOC extraction's flat `cuecs` array (a JSON array of strings on `vendor_assurance_extractions.fields["cuecs"]`) into first-class records that get auto-matched against the customer's controls inventory, with N:M mapping support and a reviewer accept / dismiss / mark-no-match workflow. The CUEC section of the document detail page changes from a bulleted list of strings to a list of CUECs, each with a mapping status (mapped to ⟨controls⟩ / suggested matches / no applicable control).

---

## 1. Matcher algorithm — LLM-based (v1 decision)

**Decision: an LLM call.** Not embeddings, not lexical.

- **No embedding infrastructure exists** in the platform — no pgvector extension, no embedding columns on `controls`, no embeddings table. Building a control-embedding pipeline + backfill is a prerequisite infra package, out of scope here.
- **Lexical (ILIKE) matching is useless** for this shape. The platform's only existing matcher (`cyberSignalProcessingService.runMatcherForSignal`) is ILIKE name-equality; a CUEC is a full sentence ("The user organization is responsible for restricting physical access to its facilities") and a control name is terse ("Physical Access Control") — token overlap is weak and noisy.
- **An LLM is well-suited** to "long requirement statement → short control name/description". Sonnet does this reliably.
- **Cost is bounded:** one LLM call per document (or per Re-match pass) — the prompt carries the *full* CUEC list and the *full* active-controls list (capped at `CUEC_MATCHER_MAX_CONTROLS = 400`; a >400-control org gets the first 400 alphabetically — flagged below). Roughly $0.05–0.20 per document.
- **Calibration is easier than with embeddings:** a tunable prompt and an explainable per-match `reasoning` string, vs. opaque cosine distances.

### Matcher contract (`src/api/lib/vendorAssuranceCuecMatcher.ts`)

- `CUEC_MATCHER_MODEL_ID = "claude-sonnet-4-6"`, `CUEC_MATCHER_PROMPT_VERSION = "cuec-matcher-v1"`. Reuses the `claudeSocExtractor.ts` Anthropic-client pattern (`new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })`, `messages.create`, strip markdown fences, `JSON.parse`).
- Model returns `{ "matches": [ { "cuec_ordinal": <int>, "control_id": "<uuid from the list>", "score": <0-100 int>, "reasoning": "<≤200 chars>" } ] }`.
- `validateCuecMatcherResponse` (pure, unit-tested) **drops** any match whose `cuec_ordinal` isn't a known ordinal in the document, whose `control_id` isn't one of the active controls passed to the prompt, or whose `score` isn't a finite number; it lowercases `control_id`, clamps `score` to 0–100, de-dups repeated `(ordinal, control_id)` pairs, and logs the dropped count. A malformed top-level shape (`response_not_object` / `matches_not_array`) → the whole run is `invalid_response` and **nothing is written**.
- **Threshold:** `MATCH_SCORE_MIN_THRESHOLD = 60` — below this, no suggestion row. `MATCH_SCORE_HIGH_CONFIDENCE = 85` — UI shows a "High confidence" hint; **never auto-accepts**. Both are constants (calibration after staging shows real output is a separate concern).
- **Idempotency / preservation** — see §3.
- **Graceful degradation:** if `ANTHROPIC_API_KEY` is absent → `llm_unavailable`; if the call throws → `llm_failed`; either way the CUEC rows are still written, no suggestions are produced, and **existing mappings are untouched**. The in-app **Re-match** button is the recovery path. Matcher failure is strictly non-fatal to extraction (the extraction is already committed before the matcher runs).
- **v2 upgrade path:** precompute control embeddings (pgvector), cosine-rank candidates, optionally still pass the top-K to the LLM for a final scoring/explanation pass. Cheaper per re-match (no full-inventory LLM call), but needs the embedding infra package first.

---

## 2. Schema & the two structural calls

`vendor_assurance_cuecs` — one row per CUEC statement: `id`, `organization_id`, `document_id`, `ordinal` (0..n-1, contiguous per document — re-extraction / cuecs-override DELETE-then-INSERTs), `cuec_text`, `review_status` (`pending` | `reviewed_no_match`) + `review_status_reason` / `review_status_updated_by_user_id` / `review_status_updated_at` (consistency-CHECKed: when `pending`, all three are NULL; when `reviewed_no_match`, `_updated_at` is set). `UNIQUE (document_id, ordinal)`.

`vendor_assurance_cuec_control_mappings` — the N:M junction: `id`, `organization_id`, `cuec_id` → `vendor_assurance_cuecs` (CASCADE), `control_id` → `controls` (CASCADE), `mapping_status` (`suggested` | `accepted` | `dismissed`), `mapping_score` (0–100, NULL for manual rows), `mapping_source` (`auto` | `manual`), `reason` (route layer requires it for the `dismissed` transition), `created_by_user_id` (manual rows), `updated_by_user_id` (last actor on accept/dismiss), `created_at`, `updated_at`. `UNIQUE (cuec_id, control_id)`. CHECK `mapping_source = 'auto' OR (mapping_source = 'manual' AND mapping_status IN ('accepted','dismissed'))`.

### Structural call 1 — "no applicable control" lives on the CUEC row, not as a sentinel mapping

The state "user reviewed this CUEC and concluded there's no applicable control in the inventory" is otherwise indistinguishable from "not yet reviewed". `signal_match_suggestions` has no equivalent (a no-match signal just has no suggestion row). Rather than a sentinel `controls` row that mappings point at (which would pollute the inventory and require bootstrapping a fake control per org), it's a column on `vendor_assurance_cuecs`: `review_status = 'reviewed_no_match'`. The junction therefore only ever holds real `(cuec, control)` pairs; `mapping_status` has no `no_match` value. The CUEC's overall display state is derived: `reviewed_no_match` → "no applicable control"; else has an accepted mapping → "mapped"; else → "needs review".

### Structural call 2 — dismissal permanence via a simple existence check

`signal_match_suggestions` uses a *partial* unique index (one pending per target, terminal rows excluded) so the matcher can re-suggest after a dismissal. **Package 2 deliberately does the opposite:** `UNIQUE (cuec_id, control_id)` (no partial) means a `(cuec, control)` pair can only ever have one row. Before re-inserting suggestions, the matcher's `INSERT ... ON CONFLICT (cuec_id, control_id) DO NOTHING` simply skips any pair that already has a row — so a dismissed pair (or an accepted pair) is never re-proposed. Re-suggesting a dismissed pair would be an explicit future UI action (out of scope).

### Structural call 3 — the matcher hooks in the engine API process, not the intelligence-worker

The vendor-assurance "worker" is the in-process `setImmediate` task in `vendorAssuranceExtractionRunner.ts` (the intelligence-worker handles cyber signals / briefs only). So `src/api/lib/vendorAssuranceCuecMatcher.ts` is called:
- from `runExtraction`, right after `persistExtractionAndMarkExtracted` commits (`refreshCuecMappingsForDocument({ resyncRows: true })`), wrapped in try/catch — non-fatal;
- from the `cuecs` field-override success path in `recordVendorAssuranceFieldOverride` (only when `field_name === 'cuecs'`), via `setImmediate(() => refreshCuecMappingsForDocument({ resyncRows: true }))` — the override route itself is otherwise unchanged;
- inline from the `POST .../rematch-cuecs` route (so the response can carry the new mappings; the app-side wrapper uses a 90s fetch timeout since it's an LLM call).

---

## 3. State machines

```
mapping_status (vendor_assurance_cuec_control_mappings)

   matcher writes ──► suggested ──── PATCH accept ────► accepted ──┐
                          │                                       │
                          │ PATCH dismiss (reason required)        │ PATCH dismiss (reason required)
                          ▼                                        ▼
                       dismissed  ◄───────────────────────────── dismissed
                       (terminal — matcher will not re-suggest this (cuec, control) pair;
                        no API transition out of it)

   user POST .../cuecs/:id/mappings { control_id } ──► accepted   (manual; mapping_source = 'manual')
       · if the (cuec, control) pair already exists and is not 'dismissed' → flipped to 'accepted'
       · if it exists and is 'dismissed' → 409 vendor_assurance_cuec_mapping_dismissed

   Illegal (→ 409 invalid_cuec_mapping_transition): dismissed→accepted, dismissed→suggested,
   accepted→suggested. Self-transitions (accepted→accepted, dismissed→dismissed) are idempotent no-ops.
   PATCH accepts only target statuses {accepted, dismissed} (suggested is not a valid target).

   mapping_source is set at creation ('auto' for matcher rows, 'manual' for user-created rows) and
   never changes — it records who PROPOSED the pair, not who decided it. An 'auto' row can be 'accepted'
   or 'dismissed' and still reads mapping_source = 'auto'.


review_status (vendor_assurance_cuecs)

   pending  ◄──── POST .../cuecs/:id/review-status { review_status: 'pending' } ────  reviewed_no_match
            ──── POST .../cuecs/:id/review-status { review_status: 'reviewed_no_match', reason? } ────►

   Independent of mappings: a CUEC can carry dismissed mappings AND be reviewed_no_match.
   Going back to 'pending' clears review_status_reason / _updated_by_user_id / _updated_at.
```

---

## 4. Re-match semantics — what's preserved, what's replaced

`runCuecMatcherForDocument` (the manual Re-match and the extraction-time match, after `syncCuecRowsForDocument`):

| Item | On a normal re-match (cuec list unchanged) | On a re-extract / `cuecs` override (cuec list changed → `syncCuecRowsForDocument` runs first) |
|---|---|---|
| `mapping_status = 'suggested'` rows | **deleted and re-created** from the fresh LLM run against the current inventory | gone (cuec rows deleted → cascade) — then re-created from the fresh run |
| `mapping_status = 'accepted'` rows | **preserved** (not deleted; the matcher's `ON CONFLICT DO NOTHING` won't re-suggest the pair either) | gone (cascade) — the cuec list itself is different |
| `mapping_status = 'dismissed'` rows | **preserved** — and the pair is never re-suggested | gone (cascade) |
| `mapping_source = 'manual'` rows | preserved (they're `accepted`) | gone (cascade) |
| `cuec.review_status` | **preserved** (it's on the cuec row, which isn't touched) | reset to `pending` (new cuec rows) |
| Run hits `llm_unavailable` / `llm_failed` / `invalid_response` | **nothing changes** (no DELETE, no INSERT) | cuec rows already rebuilt; mappings empty; reason recorded |
| No active controls in the inventory | stale `'suggested'` rows are cleared; reason `no_controls` | same |

`syncCuecRowsForDocument` reads the document's **effective** cuecs list: the latest `cuecs` field-override's `override_value` if one exists, else `extraction.fields["cuecs"].value`. The manual Re-match route never resyncs *unless there are zero cuec rows* (a recovery bootstrap for a document whose extraction-time match failed entirely — bootstrapping from zero can't destroy any mappings).

---

## 5. Backfill

`scripts/backfill-vendor-assurance-cuecs.ts` — idempotent. For every `vendor_assurance_documents` row that has an extraction and whose `processing_status ∈ {extracted, manual_review_requested, approved, rejected, finalized}`, it runs `refreshCuecMappingsForDocument({ resyncRows: true })` — i.e. (re)builds the cuec rows from the effective list and runs the matcher. Read-only on `vendor_assurance_extractions`; writes only to `vendor_assurance_cuecs` and `vendor_assurance_cuec_control_mappings`. Logs per-document (`cuecs= controls= considered= written=` and the no-suggestions reason if any) and a final summary; exits non-zero if any document failed. Accepts an optional first arg = a single `document_id`. Run staging first, then prod once promoted:

```
DATABASE_URL='postgresql://...staging...' ANTHROPIC_API_KEY='sk-ant-...' \
  npx tsx scripts/backfill-vendor-assurance-cuecs.ts
```

Without `ANTHROPIC_API_KEY` the cuec rows are still written; those documents report `reason=llm_unavailable` and get suggestions on a later re-run (or via the in-app Re-match button).

---

## 6. Relationship to Package 1 (document presentation)

- **CUEC mapping is its own workflow with its own completion state.** Approving the extraction (Package 1) does NOT require CUEC mapping to be complete, and does NOT lock it — mappings (accept / dismiss / add / mark-no-match) stay editable on an `approved` document. This is the explicit opposite of **field overrides**, which *are* locked (409) on `approved` / `rejected` / `finalized` per Package 1.
- The Package-1 **`cuecs` field-override** (override the whole array, with a reason) remains the path for "the AI got the CUEC *list* wrong". It's locked on `approved`/`rejected`/`finalized` like every field override. When it succeeds, it triggers a CUEC re-extract + re-match (delete old cuec rows → insert new from the override value → re-match), which resets all CUEC mapping state for that document (the list changed). The override route itself is unchanged.
- **Editing an individual CUEC's text** after extraction is out of scope — use the whole-array override.
- The CuecSection on the document detail page now renders the matching surface (CuecMatchingPanel + per-CUEC CuecMappingCard) plus, beneath an "Underlying extracted CUEC list" divider, the raw `cuecs` array via the Package-1 `FieldRow` primitive (which carries the whole-array override affordance).

---

## 7. Other build-phase notes

- **Controls search endpoint:** `GET /api/controls` gained an additive `?q=<text>` mode (filters `name`/`description` by `ILIKE`, orders by `name`, no cursor) — used by the CUEC `ControlPicker` type-ahead via the `searchControlsAction` server action. The original cursor-paginated behaviour is unchanged when `q` is absent.
- **CUEC routes are not document-status-gated** (consistent with "mapping is its own workflow"): `GET .../cuecs`, `POST .../rematch-cuecs`, `POST /cuecs/:id/mappings`, `PATCH /cuec-mappings/:id`, `POST /cuecs/:id/review-status` all work regardless of the document's `processing_status`. Tenant-scoped: `cuecId`/`mappingId` routes verify org ownership via a JOIN to `vendor_assurance_cuecs.organization_id`; cross-org → 404.
- **Audit events:** `vendor_assurance.cuecs.rematched` (payload = the run summary), `vendor_assurance.cuec_mapping.created` (manual), `vendor_assurance.cuec_mapping.updated` (`from`/`to`, + `reason` on dismiss), `vendor_assurance.cuec.review_status_updated`. The matcher itself does not audit (it's a system process); its outcome is logged.

### Deferred / out of scope

- Re-running the matcher automatically when the controls inventory changes (manual Re-match only in v1; no background invalidation).
- Auto-acceptance of high-confidence matches (all matches require user action in v1).
- Embedding-based matching (v2; needs the pgvector infra package first).
- Editing individual CUEC text inline; bulk operations ("accept all suggested"); cross-document CUEC mapping reuse; evidence attachment to mappings; calibration of the score threshold post-deploy; re-suggesting a previously-dismissed pair.
