# OpenAI Credential Separation — map, staging rotation, prod/demo plan

Status as of 2026-08-15: **COMPLETE across all three environments.** Staging
rotated and validated (§7); demo **decommissioned** — credential removed, voice
retired (§8); production **rotated and deployed** (§10).
**The old shared key is held by ZERO services and is safe to revoke** (§10.4) —
that revocation is the one remaining operator action, together with the
production V1 audio probe (§10.3), which no automated check can stand in for.

> **§8.1 is the finding to read first:** the voice kill switch
> `SECURELOGIC_ASK_VOICE_ENABLED` does **not exist on `main`**. The authorized
> production interim fix cannot work as specified, and setting that flag in prod
> would be inert config masquerading as a control.

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
| `securelogic-demo-engine` | demo | `main` | ~~yes~~ **REMOVED 2026-08-15** (§8) | n/a — demo is not declared in `render.yaml` at all |
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
   `main` ships the transcribe route unconditionally — there is **no kill switch
   on `main` at all** (§8.1), so voice is not merely on by default, it cannot be
   turned off by configuration. Production
   `/api/ask/transcribe/status` returns `configured: true` while running the dead
   key. Established read-only — status `GET` only, no audio posted to production,
   nothing written.

**Why this was invisible:** `configured` tests key *presence*, never that the
key works — `!!process.env.OPENAI_API_KEY` on `main`, and
`!!process.env.OPENAI_API_KEY && askVoiceEnabled()` on `develop`. Neither form
makes a provider call. It has reported healthy through every failure. Same class
as the "control believed active that enforces nothing" pattern.

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

- **G1** — staging validation §4 fully passed; **and**
- **G2** — demo separated. **Met by removal 2026-08-15** (§8): demo holds no
  OpenAI credential at all, which is strictly stronger than rotating it; **and**
- **G3** — production rotated onto its own distinct credential and validated.
  **OPEN** — see §9.

Superseded framing: this gate originally read "prod **and** demo" as a single
G2. Demo closed by decommission rather than rotation, so the production half is
tracked separately as G3.

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

> **Superseded 2026-08-15.** Step 1 (rotate demo) was replaced by
> *decommission* demo — the operator ruled demo voice not required, so the
> credential was deleted rather than replaced (§8). Step 2 (production) stands,
> with the mechanism corrected in §8.2 and the exact acts in §9.1. Step 3
> (revocation) stands unchanged.

1. **Demo first** — lowest blast radius, and it proves the procedure.
   Distinct demo key → set on `securelogic-demo-engine` → redeploy → validate V1.
2. **Production second**, in a declared window.
   Distinct prod key → set on `securelogic-engine` → redeploy → validate V1 with a
   real clip against a production tenant.
3. **Then, and only then**, revoke the original shared key at the provider, after
   confirming no service in any environment still holds it.

### Decisions the operator owns before this can run

> **Resolved 2026-08-15.** Demo voice: retired, credential removed (§8). IaC
> drift on demo: moot — demo is not in the Blueprint. Interim production
> honesty: the proposed mechanism does not exist on `main` — see §8.2, which
> supersedes the bullet below. Production credential access: unchanged,
> operator-owed.

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

---

## 7. Execution record — staging rotation, 2026-08-15

**Authorized**: operator, Option 2 (split staging now; prod/demo prepared only;
do not revoke). **Executed**: agent.

### What changed

| Act | Detail |
|---|---|
| Credential set | `OPENAI_API_KEY` on `securelogic-engine-staging` — **by the operator**, in the Render dashboard |
| Deploy | `dep-d9vs31rl550s73c078k0`, same SHA `595ea317`, **engine-staging only**, Live 01:33:19Z |
| Services NOT redeployed | app-staging (last deploy 00:54:09Z) and vendor-extraction-worker-staging (00:51:23Z) — unchanged, and neither reads the credential |
| Production / demo | **untouched**; both still hold the old shared key, confirmed by equality |
| Revocation | **not performed** |

### Distinctness

Verified by equality comparison only — no value, hash, prefix or length was
computed or displayed at any point. The staging key is distinct from both the
production and demo values. **0 staging services hold the old shared key**; only
`securelogic-engine-staging` holds an OpenAI credential at all.

### Validation — final run vs baseline

| Check | Pre-rotation baseline | Post-rotation |
|---|---|---|
| V1 voice transcription | **FAIL** 500 / upstream 401 | **PASS** 200, `{"text":"Oh"}` |
| V2 normal Ask, inline provenance | PASS (367 ch, 10 claims) | **PASS** (495 ch, 12 claims) |
| V3 long answer deferred | PASS | **PASS** (8,362 ch → `pending`) |
| V3 claims attached | PASS (74) | **PASS** (82) |
| V3 delivered text unchanged | PASS | **PASS** (identical at every poll) |
| V5 worker ticking | PASS | **PASS** (2 ticks) |
| V4/V5 worker errors | PASS (0) | **PASS** (0) |
| engine `transcription_failed` since cutoff | **FAIL** (3) | 1 — the transient below |
| | **6 pass / 2 fail** | **7 pass / 1 fail** |

### The one remaining line, and why it is not a defect

`transcription_failed` fired **once** after the redeploy — `rot-v1-40378` at
01:33:42Z, **23 seconds** after the deploy went Live — with upstream
**`err_status: 429`**, not 401.

The change in failure mode is itself the proof the rotation worked: 401 is
invalid authentication, 429 is an authenticated caller being rate-limited. The new
key authenticates. Discriminated by three spaced retries (75s apart) plus two
further probes — **five consecutive `outcome: "ok"`** at 01:44:20, 01:45:36,
01:46:53, 01:51:45, 01:52:12, and **zero** failures of any kind since 01:33:42Z.
A cold rate limit on a newly issued key, immediately after two back-to-back
validation runs.

### Harness defect found and fixed during execution

The final check originally grepped recent error lines *regardless of age*, so it
counted pre-rotation failures and would have reported FAIL permanently — a
stale-evidence trap that reads as a live signal. It now takes a
`ROTATION_CUTOFF` and counts only entries after it. Worth noting because the
first post-rotation run reported 6/2 partly on that stale basis.

### Limits of this validation — stated, not glossed

- The probe clip is a **440 Hz sine tone**, not speech; no TTS is available in
  this environment. Whisper returned `"Oh"`. This proves the **credential, upload,
  provider round trip and response parsing** — it does **not** prove transcription
  accuracy, which is a provider property. A human speaking into the browser
  remains the confirming observation, and is already an operator-owed item.
- V2–V5 are Anthropic-backed regression cover. They cannot be *fixed* by an
  OpenAI rotation and passing them is not evidence about the credential.

### Revocation status — DO NOT REVOKE

**G1 (staging) PASSED.** *(Superseded by §8/§9 later the same day: **G2 demo
PASSED by removal**; **G3 production OPEN**. Production is now the last holder of
the old shared key, and its voice is still broken by it. Revoking before the
production rotation would break production voice and nothing else.)*

---

## 8. Execution record — demo decommission, 2026-08-15

**Authorized**: operator — "Demo voice is NOT required. Remove/disable demo voice
and remove its OpenAI credential dependency." **Executed**: agent.

### What changed

| Act | Service | Detail |
|---|---|---|
| **Deleted** `OPENAI_API_KEY` | `securelogic-demo-engine` | The old shared key removed from demo entirely |
| Set `SECURELOGIC_ASK_VOICE_ENABLED=false` | `securelogic-demo-engine` | **Inert on `main` today — see §8.1**; deliberate, forward-compatible |
| Set `SECURELOGIC_ASK_VOICE_ENABLED=false` | `securelogic-demo-app` | Same |
| Deploy | `dep-d9vu5tlbedkc739eiqeg` (engine), `dep-d9vu5tu1egvs73fdvq70` (app) | Both pinned to commit `98e97098`, identical to the live SHA and to the tip of `main`; Live 03:56:07Z / 03:57:02Z |
| Production | — | **untouched** |
| Revocation | — | **not performed** |

Env-var counts reconcile: demo-engine 37 → 37 (one deleted, one added),
demo-app 6 → 7. No bulk env replace was used — only single-key
`PUT`/`DELETE`, so no unrelated variable could be disturbed.

`render.yaml` was **not** modified: it declares no demo services at all. The
"undeclared drift" recorded in §6 is therefore resolved by elimination — there
is no longer a credential on demo for the Blueprint to have an opinion about.

### 8.1 The finding that made the flag inert — and that breaks the prod plan as written

**`main` has no voice kill switch.** `SECURELOGIC_ASK_VOICE_ENABLED` is read by
**nothing** in the code production and demo run:

- `src/api/lib/ask/askVoiceFeatureFlag.ts` — **absent on `main`**
- `main`'s `transcribe.ts` POST chain begins `requireApiKey, …` with **no**
  `voiceFeatureFlag` and no `requireOrgVoiceEnabled`
- `main`'s status route is `configured: !!process.env.OPENAI_API_KEY` — it lacks
  the `&& askVoiceEnabled()` conjunct that makes a killed capability stop
  advertising itself
- `main`'s `app/src/app/ask/page.tsx` takes no props and renders `<AskClient />`
  unconditionally — there is no app-side voice switch either

The whole ASK-C / LC-4 voice-governance layer is **`develop`-only**. It has never
been released to `main`.

**How this was caught:** the post-deploy probe `POST /api/ask/transcribe`
returned `401 api_key_required` where a live kill switch must return
`404 not_found` — because on `develop` the gate is mounted *before*
`requireApiKey`, deliberately. The 401 was the discriminator. Had the validation
stopped at `configured:false`, the inert flag would have been recorded as a
working control: `configured` is `!!OPENAI_API_KEY` on `main`, so the key removal
alone fully explains it.

**Why the flags were still left on demo:** demo voice must stay off permanently.
Today the key removal is what enforces that. When the ASK-C layer eventually
reaches `main`, these flags become the enforcing control with no further action.
Leaving them is forward-compatible; removing them would create a gap at that
release. They are recorded here as **intentionally inert config**, not as a live
control — the distinction that the admin-IP-allowlist defect
(`admin-ip-allowlist-unwired`) exists to keep honest.

### Validation — demo, post-change

| # | Check | Result |
|---|---|---|
| D1 | engine `/health` | **PASS** 200 `{"status":"ok","db":"connected"}` |
| D2 | engine `/api/ask/transcribe/status` | **PASS** `{"configured":false}` — was `{"configured":true}` pre-change. On `main` this is exactly `!!OPENAI_API_KEY`, so it **proves the key is gone from the running process** |
| D3 | `POST /api/ask/transcribe` unauth | 401 `api_key_required` — expected on `main` (see §8.1); the authenticated path now classifies `transcription_unavailable` → **503**, "Voice transcription is not configured." |
| D4 | non-voice engine surfaces `/api/vendors`, `/api/findings` | **PASS** 401 — auth intact, nothing collaterally opened |
| D5 | text Ask `POST /api/ask` | **PASS** 401, **not** 404 — removing voice did not touch text Ask |
| D6 | app `/api/health`, `/login`, `/ask` | **PASS** 200 / 200 / 307-to-login |
| D7 | engine error log since deploy | **PASS** — 1 line, `export_file_purge_sweep_failed` (`relation "data_export_files" does not exist`), the known demo-DB migration drift; the identical event appears in the 28h *before* the change. Error profile unchanged |

**Not proven:** the demo mic button still renders (no app-side switch on `main`)
and now yields the honest "not configured" message rather than a misleading
retry prompt. Confirming that in a browser is operator-owed.

### 8.2 Consequence for the production interim fix — DECISION REQUIRED

The authorized interim change — set `SECURELOGIC_ASK_VOICE_ENABLED=false` in
production — **cannot work.** Production runs `main`. Nothing on `main` reads
that variable. Setting it would be inert configuration that *looks* like a
control while enforcing nothing, which is the precise failure this runbook
already documents twice (`configured:true` on a dead key; the unwired admin IP
allowlist). It must not be applied as a substitute for a fix.

**What does work on `main` today** is removing `OPENAI_API_KEY` from
`securelogic-engine`. That changes the customer-visible failure from a
misleading 500 → *"Couldn't transcribe your audio. Please try again."* (inviting
a retry that can never succeed) to an honest 503 → *"Voice transcription is not
configured on this server. Please type your question instead."* It also makes
`/api/ask/transcribe/status` report `configured:false` truthfully.

It is, however, **a different act from the one authorized**: it deletes the
production credential, which is part of the rotation the operator reserved. It
is therefore **not executed** and is put to the operator in §9.

Note also: setting the flag `false` in **production** would be actively
dangerous later — when the ASK-C layer reaches `main`, an
`SECURELOGIC_ASK_VOICE_ENABLED=false` left on prod would silently disable
production voice *after* it had been rotated and validated. For that reason the
flag is **not** declared in `render.yaml` for prod, and should not be set there
at all.

---

## 9. Production — prepared, awaiting operator decision and key material

Nothing in this section has been executed.

### 9.1 The exact change, once authorized

| Step | Service | Act |
|---|---|---|
| P1 | `securelogic-engine` (`srv-d5vmr37fte5s73cspe1g`) | Operator sets a **new, distinct** `OPENAI_API_KEY` in the Render dashboard. Value never enters this session |
| P2 | `securelogic-engine` | Same-SHA deploy pinned to the then-current `main` tip (today `98e970988a5cfbec2226ebfee839aca9cc82ee17`). Required because **Render injects env at deploy, not restart** |
| P3 | — | Validate V1 with a real clip against a production tenant — **operator-driven**, no production credential exists in this session |
| P4 | — | Confirm by equality that prod ≠ staging, and that no service in any environment still holds the old shared key |
| P5 | — | Only then consider revocation at the provider |

**No app deploy is needed.** `securelogic-app` holds no OpenAI credential and
`main`'s app has no voice switch to change.

**No `render.yaml` change is needed.** Line 172 already declares
`OPENAI_API_KEY` with `sync: false` on the prod engine — correct both before and
after a rotation, since the value is dashboard-managed.

### 9.2 Revocation gate — restated

- **G1 — staging**: PASSED (§7).
- **G2 — demo**: **PASSED by removal** (§8). Demo no longer holds any OpenAI
  credential, so it can no longer be broken by revoking the old key.
- **G3 — production**: **OPEN.** Production still holds the old shared key and
  is the **last remaining holder**. Once prod is rotated, revoking the old key
  affects nothing — which is exactly the state the gate exists to reach.

Revoking today would break production voice and nothing else.

---

## 10. Execution record — production rotation, 2026-08-15

**Authorized**: operator — "Proceed with the single same-SHA deploy, validate the
production transcription/voice path, confirm prod is credential-isolated from
staging/demo, and report whether the old shared key is now safe to revoke."
**Key material**: created and set by the operator directly in the Render
dashboard. The value never entered this session; every statement below rests on
**equality comparison only** — no value, hash, prefix or length was computed or
displayed.

### What changed

| Act | Detail |
|---|---|
| Credential set | `OPENAI_API_KEY` on `securelogic-engine` — **by the operator**, Render dashboard |
| Deploy (1st) | `dep-d9vulclbedkc739fivm0`, `trigger=manual`, same SHA `98e97098`, Live **04:29:06Z** — later **deactivated**, see §10.2a |
| Deploy (2nd, **current**) | `dep-d9vumh49v7es7386am70`, `trigger=manual`, **same SHA `98e97098`** (identical to the previously live deploy and to the tip of `main`), Live **04:31:23Z**. The operator replaced the credential a second time and re-saved |
| Deploys triggered by the agent | **none** — each dashboard save raised its own deploy, and each satisfied the same-SHA requirement. No agent-initiated deploy was needed at any point |
| Services NOT touched | `securelogic-app` (holds no OpenAI credential, and `main` has no app-side voice switch); all workers; staging; demo |
| Env diff vs pre-change baseline | `added=[] removed=[] changed=['OPENAI_API_KEY']` — **exactly one variable**, 70 → 70 |
| Revocation | **not performed** — see §10.3 |

### 10.1 Two failed delivery attempts — recorded because the failure mode is instructive

The operator twice reported the key as set when it had not reached Render. Both
times the agent **refused to deploy** and re-verified instead. What established
it, in increasing order of strength:

1. Prod's `OPENAI_API_KEY` was byte-identical to the pre-change baseline anchor.
2. A full env diff showed `added=[] removed=[] changed=[]` — *nothing* had moved.
3. `securelogic-engine.updatedAt` was still `2026-08-12T14:27:23Z`, and its event
   log's newest entry was the 12 Aug deploy.
4. **0 env groups** exist in the workspace, so nothing could be inherited
   invisibly — the service-level endpoint is the whole truth.
5. No service anywhere in the workspace held a new `OPENAI*`/`WHISPER*` value,
   and only one workspace is visible to the token.
6. Freshness control: the agent's own demo env writes at 03:53 were visible via
   the API immediately, so the reads were not stale.

**Why this mattered.** A same-SHA deploy against the unchanged dead key would
have produced a `401` on the first real audio POST, and the natural reading of
that failure would have been "the new key is bad" — sending the investigation
after a healthy credential. The cost of verifying first was two API calls; the
cost of not verifying would have been a misdiagnosed production rotation.

The third attempt succeeded and was detected by a watcher polling for the value
to differ from the anchor, which is why no further round trip was needed.

### 10.2a The second save — why the first validation was discarded

The operator replaced the credential **again** at ~04:29:56Z and re-saved, ~27
seconds after the first validation pass ran (04:29:29Z). That raised
`dep-d9vumh49v7es7386am70`, which went Live at 04:31:23Z and **deactivated**
`dep-d9vulclbedkc739fivm0`.

**The first validation was therefore stale** — it exercised a process that no
longer exists. It is not carried forward. The table in §10.2 is a full re-run
against the currently-live deploy. Detected by comparing `service.updatedAt` and
the deploy list against the previously recorded ids, before re-probing; a report
that simply re-stated the earlier PASS would have described a dead process.

**Verifiability cost — stated, not glossed.** The old-shared-key anchor was
shredded at ~04:30Z (§10.5), *between* the two saves. So for the **current**
value the runbook can prove distinctness from staging, demo and the app tier by
equality, but **cannot re-prove distinctness from the original shared key** — no
copy of that value survives anywhere (deleted from demo, overwritten on prod,
shredded from disk). This is closed by either of the two actions already
outstanding, and needs no third:

- **Revoking the old key at the provider** (§10.4) makes the question moot; or
- **V1 passing** (§10.3) proves the live credential is valid, which the old key —
  dead with a 401 — cannot be.

Retaining a plaintext copy of a dead secret purely to defend against the operator
re-pasting their own retired key was judged the worse trade.

### 10.2 Validation — production, post-deploy

*Re-run in full against `dep-d9vumh49v7es7386am70` (Live 04:31:23Z), 04:33Z.*

| # | Check | Result |
|---|---|---|
| P0 | Key distinctness | **PASS** — prod ≠ staging; demo and both app tiers hold none. Distinctness from the *original shared key* was proven for the first rotated value at 04:29Z (holders 3 → 0) but **cannot be re-proven for the current value** — see §10.2a |
| P0b | Value well-formed | **PASS** — non-empty, single-line, no quotes/whitespace, ASCII, expected key shape |
| P1 | engine `/health` | **PASS** 200 `{"status":"ok","db":"connected"}` |
| P2 | `/api/ask/transcribe/status` | 200 `{"configured":true}` — **presence only, NOT proof the key works** (see §10.3) |
| P3 | `/api/vendors`, `/api/findings` | **PASS** 401 — auth intact |
| P4 | text Ask `POST /api/ask` | **PASS** 401 — unaffected |
| P5 | app `/api/health` | **PASS** 200 |
| P6 | engine error + warn logs since Live | **PASS** — **0 errors, 0 warnings** since 04:31:23Z |
| P7 | prod voice kill switch absent | **PASS** — `SECURELOGIC_ASK_VOICE_ENABLED` is not set on prod, and deliberately not declared in `render.yaml` (§8.2) |

### 10.3 What is NOT proven — the honest limit

**The new production key has never been exercised against OpenAI.** Prod's only
`/api/ask/transcribe` traffic today is three `GET /status` calls (00:43:52Z, the
read-only mapping probe; 04:29:29Z and 04:33:48Z, the two validation passes).
**Zero** audio has ever been posted to production.

`configured: true` is `!!process.env.OPENAI_API_KEY` on `main` — it makes no
provider call. It reported `true` throughout the entire outage while running a
dead key. **It is the exact signal this incident exists to discredit, and it must
not be read as a passing V1.**

V1 for production remains **operator-owed** — there is no production credential
in this session ([[no-prod-credential-available]]). The request:

```
POST https://securelogic-engine.onrender.com/api/ask/transcribe
  Authorization: <prod session JWT or API key, premium-entitled, non-contributor>
  x-voice-diagnostic-id: prod-rot-v1-001
  multipart/form-data; file=<a real audio clip: webm/ogg/mp4/m4a/mpeg/wav/mp3, <10MB>
```

- **200** + transcript → the rotation is proven end-to-end.
- **500** `openai_error` → check the engine log for `transcription_failed`
  `err_status`. **401 = the new key is invalid** (rotate again). **429 = the key
  authenticates but is rate-limited** — which is a PASS for credential purposes;
  staging showed exactly this on a cold newly-issued key at 01:33:42Z and cleared
  within eleven minutes.
- **503** `transcription_unavailable` → the key is not in the process; the deploy
  did not carry it.

The distinction between 401 and 429 is the whole diagnostic. Do not let a 429 be
recorded as a failed rotation.

### 10.4 Revocation ruling

**The old shared key is now safe to revoke.**

| Gate | Status |
|---|---|
| G1 — staging separated + validated | **PASSED** (§7) |
| G2 — demo separated | **PASSED by removal** (§8) — demo holds no OpenAI credential at all |
| G3 — production separated | **PASSED for dependency purposes** (§10) — prod holds a distinct key, deployed and loaded (currently `dep-d9vumh49v7es7386am70`) |

Holders of the old shared key went **3 → 0**, verified by equality against the
pre-change anchor at 04:29Z, after staging's rotation, demo's deletion and
production's first rotation. Nothing in any environment referenced it at that
point.

The operator then replaced production's credential once more (§10.2a). That
second value is verified distinct from staging, demo and the app tier, but the
anchor no longer exists to re-check it against the original shared key. The
ruling is unchanged: revoking a key that is already dead at the provider cannot
break anything, and if the current production value were somehow the retired key,
**revocation is precisely what would surface it** — immediately and unambiguously,
as a 401 on V1.

Two qualifications, neither of which blocks revocation:

1. **Revoking it changes nothing functionally.** The key is already invalid at
   the provider (401, established in §2). It has been dead throughout. Revocation
   here is hygiene — closing an unused credential — not a mitigation.
2. **It is not a rollback target.** If prod's V1 fails, the old key cannot be
   restored as a fallback, because it never worked either. So holding revocation
   open "until V1 passes" buys nothing. The correct response to a failed V1 is a
   *new* key, not the old one.

**Recommendation: revoke it at the provider now.** Then delete this runbook's
remaining operator action — nothing else depends on it.

### 10.5 Session hygiene

The pre-change env snapshots captured for equality comparison contained live
secret values. Five of six were deleted immediately after the demo step; the
sixth (`env-prod-engine.json`, the old-shared-key anchor) was retained at mode
`600` only as long as it was needed to prove distinctness, and was **shredded at
the close of the production rotation**. No key file was used — the operator
delivered via the Render dashboard.
