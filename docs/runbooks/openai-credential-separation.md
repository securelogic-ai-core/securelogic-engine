# OpenAI Credential Separation — map, staging rotation, prod/demo plan

Status as of 2026-08-15: **staging rotation PREPARED, not executed** (blocked on
replacement key material). **Prod/demo separation PREPARED ONLY — not authorized,
not executed.** The shared key is **not revoked** and must not be until §5 passes.

---

## 1. Verified dependency map

Established 2026-08-15 from code and from the Render API. No secret value, hash,
prefix or length was displayed at any point; cross-environment sameness was
established by **equality comparison only**.

### Which services hold `OPENAI_API_KEY`

| Service | Env | Branch | Holds key | Declared in `render.yaml` |
|---|---|---|---|---|
| `securelogic-engine-staging` | staging | `develop` | **yes** | yes (line 513) |
| `securelogic-engine` | production | `main` | **yes** | yes (line 172) |
| `securelogic-demo-engine` | demo | `main` | **yes** | **NO — undeclared drift** |
| all other services (both apps, all four worker pairs, website, intelligence-api) | — | — | no | — |

There are **0 env groups** in the workspace, so no service inherits the key
indirectly. The only Render secret files anywhere are `issue.public.pem` /
`issue.private.pem` on the production engine (JWT signing, unrelated).

### What the credential actually powers

Exactly one capability, in one process:

- **Ask voice transcription** — `POST /api/ask/transcribe` → OpenAI Whisper
  (`whisper-1`), in `src/api/routes/transcribe.ts`. This is the **only**
  `import OpenAI` in the repository.

The credential name `OPENAI_API_KEY` is the only one used. There is no
`AZURE_OPENAI_*`, no `OPENAI_BASE_URL`, no `OPENAI_PROJECT`/`_ORG`, no
`WHISPER_*` variant anywhere in source or IaC.

### What does NOT use it — checked, not assumed

| Capability | Actual provider | Evidence |
|---|---|---|
| Ask text answers | Anthropic | `src/api/routes/ask.ts:83` |
| Long-answer async provenance | Anthropic | `src/api/workers/askProvenanceWorker.ts:248`; its host service `securelogic-vendor-extraction-worker-staging` holds **no** OpenAI key |
| Vendor evidence analysis | Anthropic | `src/api/lib/claudeEvidenceAnalyzer.ts` |
| Brief synthesis / signal enrichment | Anthropic | `briefSynthesizer.ts`, `intelligenceBriefGenerator.ts` |
| LLM control matcher, predictive intelligence | Anthropic | `llmControlMatcher.ts`, `predictiveIntelligence.ts` |
| **Realtime voice readback (LC-4)** | **none — no network recipient** | browser-local `SpeechSynthesis` (`app/src/app/ask/voiceGovernance.ts`); adds no audio recipient by design |

**Consequence for scoping:** "every staging service that consumes the OpenAI
credential" is exactly **one service** — `securelogic-engine-staging`. This is a
finding, not a shortcut: the worker fleet was checked individually and none of
them imports the OpenAI SDK or holds the key.

---

## 2. The finding that reshapes the operation

**The three keys are identical.** `securelogic-engine` ≡
`securelogic-engine-staging` ≡ `securelogic-demo-engine`.

1. There is no staging-scoped OpenAI credential. Rotating staging is a **split**
   of a shared credential, not a replacement of a staging one.
2. **A staging-only rotation can never make the old key revocable.** Prod and demo
   would still hold it. Any runbook step that concludes "safe to revoke" after
   staging-only work is wrong and would take down production voice.
3. **Production voice transcription is already broken by the same root cause.**
   `main` ships the transcribe route; `SECURELOGIC_ASK_VOICE_ENABLED` defaults
   **ON** (only the literal `"false"` disables) and is absent in production; and
   production `/api/ask/transcribe/status` returns `configured: true` while
   running the dead key. Established read-only — status `GET` only, no audio
   posted to production, nothing written.

**Why this was invisible:** `configured` tests key *presence*
(`!!process.env.OPENAI_API_KEY && askVoiceEnabled()`), never that the key works.
It has reported healthy through every failure. Same class as the "control
believed active that enforces nothing" pattern.

### Failure classification

`POST /api/ask/transcribe` on staging returns **500** `openai_error` with engine
log `transcription_failed err_status: 401`, correlated via the
`x-voice-diagnostic-id` header (`rot-map-001`, 2026-08-15 00:44:51Z). **401 =
invalid authentication** — the key is dead at the provider, not throttled (429)
and not permission-scoped (403). The audio passed every gate and failed only at
the provider auth boundary.

---

## 3. Staging rotation — the bounded operation

**Blocked on step 0.** Everything else is ready to run.

**0. Replacement key material.** A distinct, staging-only OpenAI API key must
exist. This cannot be produced from this environment (no OpenAI account access)
and must not be pasted into a chat transcript. Two acceptable delivery paths:
  - the operator sets it directly on `securelogic-engine-staging` in the Render
    dashboard (this also completes step 1); or
  - the operator writes it to a local file readable by the session, which is read
    and submitted via the Render API without being displayed, then deleted.

**1. Update the credential — `securelogic-engine-staging` ONLY.** One service;
see §1. No app, worker, or website service holds or reads it.

**2. Deploy to load it.** Render injects env at **DEPLOY, not restart**
(2026-08-05 incident). A same-SHA redeploy of `securelogic-engine-staging` is
required and sufficient. No other service needs redeploying — none reads the key.

**3. Validate (§4). 4. Confirm no staging service holds the old key (§5).**

**Production and demo are not touched at any point in this procedure.**

---

## 4. Validation set

Run against `securelogic-engine-staging` as `walkthrough-analyst@seed.securelogicai.test`
in `[SEED] Walkthrough Org`. Each is independent; all must pass.

| # | Path | Expected |
|---|---|---|
| V1 | Voice transcription — `POST /api/ask/transcribe`, real audio clip | **200** with transcript text; engine log shows no `transcription_failed`. **This is the only check the rotation can change.** |
| V2 | Normal Ask — short question, `POST /api/ask` | 200, inline provenance with claims (baseline 2026-08-15: 516 chars → 12 claims in 15.9s) |
| V3 | Long-answer async provenance | 200 with `provenance_status: "pending"`, then claims attach at `complete`/`partial` (baseline: 7,521 chars → 62 claims) |
| V4 | Evidence analysis | **Anthropic-backed — structurally cannot be affected.** Validated as a non-regression: vendor-extraction worker ticks cleanly, no analysis errors |
| V5 | Worker health/logs | `securelogic-vendor-extraction-worker-staging` Live on the current SHA, `vendor_extraction_worker_tick_complete` emitting, zero errors |

V2–V5 are regression cover: they share the engine process (V2/V3) or the worker
(V4/V5) and would surface a deploy that broke something unrelated. Only V1 can be
*fixed* by the rotation — stating that up front prevents a passing V2 from being
read as evidence the credential works.

---

## 5. Revocation gate — DO NOT REVOKE

The old shared key stays live after the staging rotation. Revocation is gated on
**both**:

- **G1** — staging validation §4 fully passed; and
- **G2** — production **and** demo have been separately rotated onto their own
  distinct credentials under explicit authorization (§6), and validated.

Post-staging-rotation check: no staging service's `OPENAI_API_KEY` equals the
production service's current value. Performed as an equality comparison against
prod's live value — which is the old shared key — so it needs no retained copy of
the secret and exposes nothing.

Revoking after G1 alone **will break production and demo voice transcription.**

---

## 6. Prod/demo separation — PREPARED ONLY, NOT AUTHORIZED

Not executed. Recorded here so the change is reviewable before anyone runs it.

### Why it is needed independently of this incident

Production voice is broken **now** and will stay broken after the staging
rotation, because it holds the same dead key. Staging work does not fix it. This
is also a standing isolation defect in its own right: a demo environment holding
a production credential is the same failure already recorded for Resend
(`email-environment-isolation-p12`, `resend-staging-prod-shared-credentials`),
where demo was confirmed sharing the production key and secret.

### Proposed sequence

1. **Demo first** — lowest blast radius, and it proves the procedure.
   Distinct demo key → set on `securelogic-demo-engine` → redeploy → validate V1.
2. **Production second**, in a declared window.
   Distinct prod key → set on `securelogic-engine` → redeploy → validate V1 with a
   real clip against a production tenant.
3. **Then, and only then**, revoke the original shared key at the provider, after
   confirming no service in any environment still holds it.

### Decisions the operator owns before this can run

- **Production credential access.** Authenticated production probes are
  operator-owed — there is no production credential in this environment. V1
  against production requires an operator-driven check.
- **IaC drift on demo.** `securelogic-demo-engine` carries `OPENAI_API_KEY`
  undeclared in `render.yaml`. Either declare it (`sync: false`) or decide demo
  should not have voice at all and remove the key. Leaving it undeclared means
  the next Blueprint sync has no opinion about a live credential.
- **Should demo have voice at all?** If demo voice is not demonstrated, deleting
  the key is strictly better than rotating it — one fewer credential, one fewer
  environment to rotate next time.
- **Interim honesty in production.** While prod voice is broken, `configured:
  true` advertises it as working. Setting `SECURELOGIC_ASK_VOICE_ENABLED=false`
  in production would make the UI stop offering a capability that cannot succeed.
  That is a production change and is **not** proposed as part of any staging
  work — flagged for the operator's decision only.

### Follow-up worth separating from the rotation

The `configured` probe returning `true` for a dead credential is the reason this
went unnoticed. A liveness check (as opposed to a presence check) would have
caught it. Not proposed here — it is new work and belongs in scoping, not in a
credential rotation.
