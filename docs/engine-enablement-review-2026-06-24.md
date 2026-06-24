# Dormant Engine Enablement Review — GAP-1 / GAP-3 / Fuzzy (2026-06-24)

## Why this exists
The "match → surface → what to do next" engine is **built, tested, and in
production on `main`**, but switched **OFF** behind three feature flags. No
customer sees its output today. This is the highest-ROI launch step: it converts
shipped code into delivered product with **zero new code** — only staged flag
enablement, quality validation, and cost observation.

This doc is the runbook to turn it on **safely and in the right order**. It is a
validation activity, not a build. Each flag is enabled in **staging first**,
observed against the gates below, and only then enabled in **production**.

## The three flags (exact, code-verified)

| Flag (env var, value `"true"` to enable) | Gates | Output target | LLM cost? | Default |
|---|---|---|---|---|
| `SECURELOGIC_FUZZY_VENDOR_MATCH_ENABLED` | Token-distinctiveness fuzzy vendor matching (`vendorFuzzyMatch.ts`) | `signal_match_suggestions` (`target_type='vendor'`) — **suggest-only** | No | off |
| `SECURELOGIC_ACTION_ENGINE_ENABLED` | GAP-3 action generators (finding/risk/obligation/failed-assessment → action) | `actions` table — **auto-writes rows** (idempotent) | No | off |
| `SECURELOGIC_LLM_CONTROL_MATCHER_ENABLED` | GAP-1 LLM signal→control matcher (`llmControlMatcher.ts`) | `signal_match_suggestions` (`target_type='control'`) — **suggest-only** | **Yes** (Anthropic) | off |

**Where the flags must be set:** signal processing runs in two places —
`securelogic-intelligence-worker` (scheduled ingestion, the main volume) and
`securelogic-engine` (manual `POST /api/cyber-signals/fetch/*` routes). Set each
flag on **both** the staging twin and (later) both prod services. `render.yaml`
already provisions `ANTHROPIC_API_KEY` on the intelligence-worker (prod L345 /
staging L412) and engine (L243), so the LLM matcher has its key where it runs.

## Enablement order (least-risk → highest-risk)

Enable **one flag at a time**, each through its own staging→prod cycle. Do not
batch. Rationale: fuzzy is suggest-only + free; the action engine writes rows
users act on; the LLM matcher costs money per signal.

---

### Step 1 — Fuzzy vendor matching (suggest-only, free) — enable first

**Pre-checks**
- [ ] Confirm `vendorFuzzyMatch.ts` thresholds are still the validated ones:
      `FUZZY_VENDOR_MIN_SCORE=60`, `FUZZY_VENDOR_MIN_CANONICAL_LEN=5`,
      `FUZZY_VENDOR_SUGGESTION_CAP=10`, `GENERIC_TOKEN_WEIGHT=0.15`.
- [ ] Confirm the staging org has a representative set of tracked vendors
      (the single-brand-token tail this recovers — Sensata/Cisco — needs real
      vendors present to match against).

**Enable**
- [ ] Set `SECURELOGIC_FUZZY_VENDOR_MATCH_ENABLED=true` on
      `securelogic-intelligence-worker-staging` + `securelogic-engine-staging`.

**Validate (staging, ≥1 ingestion cycle)**
- [ ] New `signal_match_suggestions` rows appear with `target_type='vendor'` and
      `match_metadata` source = fuzzy. Spot-check 10–20: are they real near-misses
      (e.g. "Cisco" ↔ "Cisco Systems"), not garbage?
- [ ] **Precision gate:** false-positive rate on the sample is low enough that a
      human reviewer would accept the queue (this is the whole point of the
      precision-first design). If noisy, raise `FUZZY_VENDOR_MIN_SCORE` before prod.
- [ ] Suggestion volume per signal is bounded (cap = 10) and the review queue
      (`signalMatchSuggestions.ts` accept route) is not flooded.

**Promote**
- [ ] Set the flag on both **prod** services. Watch suggestion volume for one
      cycle.

**Rollback:** set flag to anything ≠ `"true"`. Suggest-only ⇒ no rows are
auto-applied; existing suggestions are harmless and can be left or pruned.

---

### Step 2 — Action engine (auto-writes `actions` rows, free) — enable second

**Pre-checks**
- [ ] Confirm thresholds: actions generate only for `ACTIONABLE_SEVERITIES =
      {Critical, High}` findings; obligation→action only for the **top** match
      with score ≥ `ACTION_OBLIGATION_MIN_SCORE=80`; risk→action is flat
      `near_term`. These are the spend-worthy / human-time-worthy gates.
- [ ] Confirm the idempotency partial indices exist on `actions`
      (`idx_actions_generated_finding` / `_risk` / `_obligation`, migrations
      20260625/20260627/20260628) so re-processed signals don't duplicate actions.

**Enable**
- [ ] Set `SECURELOGIC_ACTION_ENGINE_ENABLED=true` on both staging services.

**Validate (staging, ≥1 cycle)**
- [ ] New `actions` rows appear stamped with the generated `action_type` markers
      and `source_id` pointing at the originating finding/risk/obligation.
- [ ] **Idempotency proof:** re-run / re-process the same signal → **no
      duplicate** actions (ON CONFLICT against the partial index holds).
- [ ] **Relevance gate:** sampled auto-actions read as genuinely actionable
      ("what to do next"), not noise. A Moderate/Low finding must NOT spawn an action.
- [ ] The `actions.ts` read surface shows them correctly to the org; volume is
      sane (Critical/High + top-obligation gating should keep it low).

**Promote**
- [ ] Set on both prod services. Watch `actions` insert volume for one cycle —
      a spike means a threshold needs tightening.

**Rollback:** flip flag off. Already-written actions persist (they're real rows);
if a bad batch landed, delete by the generated `action_type` marker (the markers
exist precisely so generated rows are distinguishable from user-created ones).

---

### Step 3 — LLM control matcher (suggest-only, **costs money**) — enable last

**Pre-checks**
- [ ] `ANTHROPIC_API_KEY` present + funded on the services that run signal
      processing (worker + engine). **Confirm Anthropic console balance** — this
      is the only flag that spends per signal, and balance exhaustion has bitten
      this pipeline before (see memory `project_anthropic_balance_monitoring`).
- [ ] Confirm cost bounds in `llmControlMatcher.ts` are intact:
      model `claude-sonnet-4-6`, `MATCHER_MAX_TOKENS=1024`, runs **only** for
      `CONTROL_RELEVANT_SIGNAL_TYPES` ∩ severity ∈ {Critical, High}, controls
      clamped to ≤80/prompt, **after-commit** (never blocks the matcher tx),
      suggestions ≥ `CONTROL_MATCH_MIN_SCORE=50`, capped at
      `CONTROL_SUGGESTION_CAP=8`.

**Enable**
- [ ] Set `SECURELOGIC_LLM_CONTROL_MATCHER_ENABLED=true` on both staging services.

**Validate (staging, ≥1 cycle)**
- [ ] Log events fire: `llm_control_matcher_start` / `_done` (good) vs `_failed`
      (investigate). Confirm `_failed` is rare and self-contained (error-swallowing
      by design — must never break ingestion).
- [ ] New `signal_match_suggestions` with `target_type='control'`, source=llm.
      Spot-check: do the control mappings + reasoning make sense for the signal?
- [ ] **Cost gate:** measure actual calls/cycle × ~(prompt+1024 out) tokens →
      projected daily/monthly Anthropic spend. Confirm it's within budget. The
      Critical/High + relevant-type gate should make calls infrequent — verify
      that's true on real staging signal volume, not assumed.
- [ ] Confirm the cheap gate (`shouldRunControlMatcher`) actually suppresses
      Low/Moderate and irrelevant-type signals (no LLM call for those).

**Promote**
- [ ] Set on both prod services. **Watch Anthropic spend for 24h** before
      considering it settled. Keep the flag as the kill-switch.

**Rollback:** flip flag off — calls stop immediately. Suggest-only ⇒ nothing
auto-applied.

---

## Cross-cutting

**Observability to watch (all steps):** `signal_match_suggestions` insert rate
by `target_type`+source; `actions` insert rate by generated `action_type`;
`matcher_obligation_suggestions`, `llm_control_matcher_{start,done,failed}` log
events; Anthropic console balance (step 3); the `signalMatchSuggestions.ts`
accept-route usage (are humans actually reviewing the queue?).

**Hard rule:** staging validation before each prod flip. Production is for
clients; staging is for validation; do not use prod as the verification
environment (BUILD_SEQUENCE release discipline).

**These flags are independent kill-switches.** Each can be turned off in
isolation without touching the others or redeploying code — they're read from
`process.env` at signal-processing time.

## Not in scope here
- RLS rollout (item 13) — separate in-flight infra, own cadence.
- Any threshold *re-tuning* beyond what staging validation demands — start with
  the shipped, validated constants; only adjust if a gate above fails.
