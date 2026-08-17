# develop → main Production Promotion Audit

**Produced**: 2026-08-15. **Read-only.** Nothing was deployed, merged, migrated,
flipped or modified to produce this document.

**Verdict up front: NO-GO for a promotion today.** Four blockers, listed in §10.
None is "needs more testing" hand-waving; each is a specific, checkable fact.

> **Status 2026-08-15 — still NO-GO, now on two blockers.** BL-1 (migration lock
> exposure) is CLOSED. BL-3 (suite verification) is CLOSED — **re-run in full at
> the current candidate `7692c9e6`**, all eight CI jobs, evidence in
> `docs/validation/bl3-suite-verification.md` §7. **BL-2** (staging walkthrough
> legs) and **BL-4** (Vendor Assurance nav decision) remain OPEN. Neither can be
> closed by anything this repository can run — BL-2 needs a human in a browser,
> BL-4 needs an operator ruling. See §10.

> **Status 2026-08-16 — the release QUESTION changed, and two defects were found
> by acting on it. Candidate is now `91a56923`.**
>
> The operator reframed the promotion (2026-08-16): production is no longer the
> configuration the release must survive — **the validated staging experience is
> the target, and production should mirror it.** The prior plan to validate under
> `RISK_WORKSPACE_ENABLED=false` ("Config C") was explicitly abandoned mid-setup;
> no flag was changed on any environment. Consequences:
>
> - **BL-2 is substantially CLOSED.** §1–§3 of the walkthrough were executed on
>   staging under the TARGET configuration (VA end-to-end incl. external portal
>   legs, all six Ask steps incl. voice, agentic 10/10). Its unmet clause —
>   "including under `RISK_WORKSPACE_ENABLED=false` to match production nav" — is
>   retired by the reframing. One remnant: the client-rendered conversation rail
>   has still never been seen in a browser.
> - **BL-4 is CLOSED** at `5a669816`, which declares Vendor Assurance as a
>   top-level group in BOTH nav models under the operator's BL-4 ruling.
> - **BL-3 was RE-OPENED and is now RE-CLOSED.** See the two defects below.
> - **A new governing blocker, B-5, is OPEN.** Under "prod mirrors staging" the
>   LC flags are ON in production, so four gates that were explicitly ruled NOT
>   promotion blockers become exactly that: Stop Gate B.4 (real external tester),
>   Stop Gate ASK-B (agentic review), ASK-C C-6 (Whisper DPA/subprocessor), and
>   C-9 (Ask conversation-retention ruling). None is closable by code. Note also
>   that `SECURELOGIC_ASK_ACTIONS_ENABLED` / `_GOVERNED_` are environment-global
>   with no per-org gate: enabling them in production is all-or-nothing across
>   every customer at once. **B-5 now governs the verdict.**
>
> ### Defect 1 (P0, in the delta) — `POST /api/requirement-responses` 500s
>
> `20261011` (`168c8b73`) correctly drops the legacy four-column unique key on
> `requirement_responses`. `src/api/routes/requirements.ts` inferred its
> `ON CONFLICT` target from exactly those four columns, while the replacement
> index `idx_requirement_responses_unique_scoped` adds a fifth expression
> `COALESCE(engagement_id, zero-uuid)`. Result on every migrated database:
> `42P10 there is no unique or exclusion constraint matching the ON CONFLICT
> specification`. **Staging was broken from `168c8b73`; production works only
> because it has not migrated, and would have broken on arrival.** The defect is
> actually older than `20261011` — the target has been wrong since `20260924` and
> was merely propped up by the constraint that migration failed to drop.
> Blast radius is exactly one writer: `vendorPortal.ts:443` already names the
> five-expression form and `vendorEngagements.ts:1248` targets a different index.
> That asymmetry is why the §1 walkthrough passed — it drove the vendor-portal
> path; the internal framework/self-assessment path has no walkthrough leg.
> **FIXED at `c53d3b9d`.**
>
> ### Defect 2 (P2) — stale LC-5b assertion
>
> `askGovernedExecution` still asserted the pre-W-5 bare `cannot_decide`; W-5
> (`26c11f99`) deliberately composes `error: reason`. Behaviour correct, test
> left behind — i.e. `26c11f99` shipped without an isolation run. **FIXED at
> `91a56923`.**
>
> ### Also found and fixed — the posture worker was never on the candidate
>
> `securelogic-posture-worker-staging` had **20 consecutive `build_failed`
> deploys** while still running pre-LC code. Workers have no HTTP endpoint, so
> the `/health` and `/api/version` probes this audit relied on could not see it:
> "staging is on SHA X" was false for that service. Cause: the Ask tool registry
> imports the whole `routes/index.ts` barrel, so every tsconfig including
> `src/api/lib` compiles the entire route tree — and the worker's build lacked
> the `rawBody` augmentation that lived inside `app.ts`. **FIXED at `d88dfc99`**
> (augmentation moved to `src/api/types/express-raw-body.d.ts`); the worker is
> now `live` and its boot cycle completed 13 orgs / 0 failures. The over-broad
> `include` was deliberately NOT narrowed inside this release.
>
> ### Evidence at `91a56923` (local, C-locale Postgres)
>
> lint / typecheck / build / url-drift / guard-imports: **0**. Engine **8,094
> passed** (499 files, 3 skipped). App **1,744 passed** (134 files). test:prod
> 18 passed. tenant-coverage **260 warn-only** (unchanged). **Isolation
> 152 files / 1,175 tests / 0 failures — fully green for the first time in this
> release** (was 150/152 and 1,170/1,175). `npm audit` 7 high, inherited: no
> lockfile change in any of these three commits.
>
> **Caveat on the isolation baseline.** `migrationFilenameOrder` compares a
> Postgres `ORDER BY` against a JS code-point sort, so it passes only under `C`
> collation and fails under `en_US.utf8`. That is test fragility, not a defect,
> but it means an isolation result is only comparable when the locale is stated.

---

## 1. Current SHAs

| Position | SHA | Notes |
|---|---|---|
| `origin/main` | `98e97098` | 2026-08-12 09:48 -0400 |
| `origin/develop` | `58aafc97` | 2026-08-15 04:36 Z |
| **prod engine** (`securelogic-engine`) | `98e97098` | `dep-d9vumh49v7es7386am70`, Live 04:31:23Z (today's OpenAI rotation) |
| **prod app** (`securelogic-app`) | `98e97098` | `dep-d9u7j70ae00c73budvv0`, Live 2026-08-12 |
| **staging engine** | `58aafc97` | `dep-d9vuqclg1s2s73b5ti50`, Live 04:39:38Z |
| **staging app** | `58aafc97` | `dep-d9vuqclg1s2s73b5thkg`, Live 04:41:51Z |
| demo engine / app | `98e97098` | tracks `main` |
| prod vendor-extraction worker | `98e97098` | **relevant — hosts two new job types** |
| staging vendor-extraction worker | `58aafc97` | |

**Divergence: 34 commits ahead, 3 behind.** The 3 behind are two merge commits
(their content is already in develop) and `83f41957`, a `render.yaml`-only change
made directly on `main`. Verified: develop's `render.yaml` retains those EAR/ECL
values, so promotion does not revert them.

**Delta size: 211 files, +43,568 / −736.**

---

## 2. Full `main..develop` delta, classified

| Class | Weight | Content |
|---|---|---|
| **Vendor Assurance** | **Largest** | Engagement spine (Phases 0–6), intake/scope/effectiveness, findings promotion, monitoring/reassessment, evidence analysis, B1 legacy-writer demotion, 9 new app pages/components |
| **Vendor portal (external)** | Large | `/portal/*` (8 pages), `vendorPortal.ts`, invites + sessions, app proxy `api/vendor-portal/[...path]`. **The platform's only unauthenticated write path** |
| **Ask SecureLogic** | Large | A0 truth pass + kill switch + audit trail, A1 tool-registry retrieval, A2/A3 conversations, requester-aware knowledge (LC-2) |
| **Ask streaming / provenance** | Medium | SSE transport (LC-3), inline claim verification, **async provenance** via worker (`2833a0ea`, `602965c4`, `05625d02`) |
| **Voice / ASK-C** | Medium | Voice kill switch, per-org voice governance, transcribe diagnostics, realtime readback (LC-4, dark) |
| **Agentic Ask** | Medium | LC-5 bounded mutate class, LC-5b governed transitions — **both dark** |
| **Navigation / UX** | Medium | Search + Ask promoted to global utilities (`c13a6cbc`), conversation rail (`66204045`), `/vendor-assurance` landing page |
| **Entitlement / access** | Small | Ask access truth (LC-2), portal session model, seat interactions |
| **Schema / migrations** | **15 migrations** (**16 applied** — see §3) | §3 |
| **Workers / jobs** | Medium | `askProvenanceWorker`, `vendorEvidenceAnalysisWorker`, `vendorAssuranceMonitoringWorker`; `jobs.job_type` CHECK widened |
| **Intelligence** | Minimal | No pipeline changes in this delta |
| **Security / auth / RLS** | Medium | RLS on 9 previously-unprotected vendor tables, portal token hashing, tenant-wrap structural guards |
| **Config / feature flags** | Small | 8 new flags; `render.yaml` +141/−11 |
| **CI / infra** | Small | 1 workflow file |
| **Documentation only** | 10 files | validation + runbooks |
| **Unrelated** | None found | Every commit maps to VA, Ask, or their infrastructure |

---

## 3. Database impact — 15 migrations production does not have

> **Superseded in two places by later commits on this branch — 2026-08-15.**
>
> 1. **The "no timeouts" claim below is no longer true.** `b363e144` moved the
>    transaction body to `src/api/lib/migrationRunner.ts` and now issues
>    `SET LOCAL lock_timeout` (default **5s**) and `SET LOCAL statement_timeout`
>    (default **300s**) inside every migration transaction. Neither is set in
>    `render.yaml`, so the defaults apply on arrival in production. The unbounded
>    wait described below is bounded as of that commit. Evidence:
>    `docs/validation/migration-timeout-hardening.md`.
> 2. **The count is effectively 16, not 15.** `7692c9e6` renamed
>    `20260522_alert_preferences.sql` to `20260417_alert_preferences.sql` (its
>    real commit date) so the set applies to an empty database in strict filename
>    order. Production's `schema_migrations` records the **old** filename, so the
>    renamed file is unapplied by that bookkeeping and **prod will apply it once
>    at this promotion**, ending with both filenames recorded. Proven harmless
>    against a rewound scratch database: one migration applied, exit 0,
>    `pg_dump --schema-only` byte-identical before/after, no row loss and a
>    non-default column value preserved. No operator action, no backfill, no
>    re-stamp. Evidence: `docs/validation/migrate-from-scratch-defect.md`.

**Execution model (this is the risk multiplier):** the prod engine's
`startCommand` is `npm run migrate && npm start`. Migrations run **at deploy,
blocking service start**, each in its own `BEGIN`/`COMMIT`. ~~**No `lock_timeout`
and no `statement_timeout` are set anywhere in the runner.**~~ — corrected above.

**No migration uses `NOT VALID`. No index is built `CONCURRENTLY`.** Every CHECK
is added fully validated (full table scan under `ACCESS EXCLUSIVE`); every index
build takes a write lock.

| Migration | Type | Lock / backfill risk | Rollback | Code assumes unconditionally? |
|---|---|---|---|---|
| `20260919_vendor_engagements` | Additive — new table | None (empty) | `DROP TABLE` | Yes |
| `20260920_vendor_engagements_rls` | Additive — RLS on new table | None | Drop policy | n/a |
| `20260921_vendor_tier_b_rls` | **RLS on 9 EXISTING populated tables** | **None at promotion — see note** | Drop policies | n/a |
| `20260922_ask_conversations` | Additive — 3 new tables | None | `DROP TABLE` | **Yes — writes unconditionally, §5** |
| `20260923_vendor_portal_access` | Additive — invites + sessions | None | `DROP TABLE` | Portal only |
| `20260924_vendor_engagement_scope` | Additive — 2 tables; **widens CHECK on `requirement_responses`** | Low (small table) | Drop tables; re-narrow CHECK | Yes |
| `20260925_vendor_portal_evidence_comments` | **ALTERS SHARED `evidence`** | **HIGH — validated CHECK + 3 FK columns on a large populated table** | Drop constraints **before** columns | **Yes — and NOT portal-only, see §9** |
| `20260926_requirement_scope_tags` | Additive column + **data backfill over every `requirements` row** | Medium — full-table `UPDATE`; idempotent, never overwrites `curated` | Drop columns | Yes |
| `20260927_engagement_intake_and_effectiveness` | 16 ALTERs on `vendor_engagements` | None (new/empty table) | Drop columns | Yes |
| `20260928_vendor_engagement_findings` | **ALTERS SHARED `findings`** | **HIGH — widens `source_type` CHECK (validated) + partial unique index, non-concurrent** | Drop index/columns, re-narrow CHECK | Yes |
| `20260929_vendor_engagement_monitoring` | Additive columns + partial index | Medium — non-concurrent index on `risks` | Drop columns/index | Yes |
| `20260930_engagement_evidence_analysis` | Additive table + RLS; **widens `jobs.job_type` CHECK** | Low–Medium (`jobs` churns) | Drop table; re-narrow after confirming no rows | Yes |
| `20261001_org_voice_enablement` | `organizations` ADD COLUMN NOT NULL DEFAULT true | Low — metadata-only in PG11+ | Drop column | Yes |
| `20261002_ask_proposed_actions` | Additive table | None | `DROP TABLE` | Agentic only (dark) |
| `20261010_ask_async_provenance` | Additive table + `ask_messages` CHECK | Low (new table) | Drop table | Yes |

**RLS note — the good news, precisely stated.** `20260921` is a **no-op in
production on arrival**. The engine connects as the database **owner**, which
**bypasses RLS**; policies bite only after a future `DATABASE_URL` repoint to the
non-owner `app_request` role, which is **not part of this promotion**. Policies
use `NULLIF(current_setting('app.current_org_id', true), '')::uuid` and fail
**closed**. No table is set `FORCE`, so the elevated channel keeps working. This
is correctly built — but it arms a loaded gun for the eventual flip.

**The unquantified risk.** `evidence` and `findings` are large, shared,
production-populated tables read by every remediation, control-test and findings
surface. `20260925` and `20260928` take `ACCESS EXCLUSIVE` on them, validate a
full scan, with **no lock timeout**, **while the engine is booting**. Render
keeps the old instance serving during deploy, so the old instance's queries block
behind that lock. **Row counts were not measurable from this session** (no
production database credential). This must be measured before promotion:

```sql
SELECT count(*) FROM evidence;  SELECT count(*) FROM findings;
SELECT count(*) FROM requirements;   -- 20260926 backfills every row
```

**Required deployment order:** engine (migrates) → vendor-extraction worker →
app. The worker must not start before the `jobs.job_type` CHECK is widened, and
the app must not ship before the engine routes it calls exist.

---

## 4. Feature-flag impact

Defaults verified from develop source, not from documentation.

| Flag | main today | develop behaviour | **prod value** | Default if absent | Scope | Safe value at promotion |
|---|---|---|---|---|---|---|
| `SECURELOGIC_ASK_ENABLED` | **not read** | kill switch, `!== "false"` | **unset** | **ON** | env-global | leave unset (ON — preserves live Ask) |
| `SECURELOGIC_ASK_TOOLS_ENABLED` | not read | `=== "true"` | unset | OFF | env-global | leave unset |
| `SECURELOGIC_ASK_STREAMING_ENABLED` | not read | `=== "true"` | unset | OFF | env-global | leave unset |
| `SECURELOGIC_ASK_PROVENANCE_ENABLED` | not read | `=== "true"` | unset | OFF | env-global | leave unset |
| **`SECURELOGIC_ASK_VOICE_ENABLED`** | **NOT CONSUMED AT ALL** | kill switch, `!== "false"` | **unset** | **ON** | env-global | **leave unset — see below** |
| `SECURELOGIC_ASK_VOICE_REALTIME_ENABLED` | not read | `=== "true"` | unset | OFF | env-global | leave unset |
| `SECURELOGIC_ASK_ACTIONS_ENABLED` | not read | `=== "true"` | unset | OFF | env-global | leave unset |
| `SECURELOGIC_ASK_GOVERNED_ENABLED` | not read | `=== "true"` | unset | OFF | env-global | leave unset |
| `SECURELOGIC_VENDOR_PORTAL_ENABLED` | not read | `=== "true"` | unset | OFF | env-global | leave unset |
| `SECURELOGIC_LEGACY_VENDOR_WRITES_ENABLED` | not read | `!== "false"` | unset | **ON** | env-global | leave unset (legacy writes keep working) |
| `SECURELOGIC_VENDOR_ASSURANCE_ENABLED` | read | unchanged | **true** | — | env-global | unchanged |
| `SECURELOGIC_SEAT_MODEL_ENABLED` | read | unchanged | **true** | — | env-global | unchanged |

**Every new flag is environment-global. There is no per-org gate on any of them.**
A flip is all-tenants-at-once.

### `SECURELOGIC_ASK_VOICE_ENABLED` — the specific attention requested

`main` **does not consume this variable**. Verified: `askVoiceFeatureFlag.ts` is
absent on `main`; `main`'s transcribe POST chain begins `requireApiKey` with no
voice gate; `main`'s status route is `configured: !!process.env.OPENAI_API_KEY`
without the `&& askVoiceEnabled()` conjunct; `main`'s `/ask` page renders
`<AskClient />` with no props and no app-side switch.

Consequences:

1. **Setting it in production today is inert config that reads as a control** —
   the `admin-ip-allowlist-unwired` pattern. It must not be set as a pre-promotion
   "safety" measure, because it would provide none.
2. **At promotion it becomes live and defaults ON.** Production voice does not
   change state (it is already unconditionally on) — but it *gains* a real kill
   switch and per-org governance (`organizations.voice_input_enabled`, default
   `true`) for the first time.
3. **The trap:** if anyone sets it `"false"` in prod *before* promotion believing
   it disables voice, that value becomes live at promotion and silently disables
   production voice — after the credential was rotated and validated. It is
   deliberately **not** declared in `render.yaml` for prod for this reason.

### Flag deviation found

`SECURELOGIC_VENDOR_PORTAL_ENABLED = "true"` on the **staging engine**. The
runbook states this flag must be **off everywhere including non-production**,
because an external write surface "must never be open by accident on a preview
environment." Staging needed it for Stop Gate B work, but the live value now
contradicts the documented posture. Not a promotion blocker (prod is unset) —
but it should be an explicit decision, not drift.

### IaC drift found (in main's favour to fix)

`main`'s `render.yaml` declares prod `SECURELOGIC_SEAT_MODEL_ENABLED: "false"`
while the **live production value is `"true"`** (GATE B, 2026-08-12). A Blueprint
sync against `main` today would disable a live production capability. **develop
corrects this to `"true"`.** Promotion improves this; it is an argument *for*
promoting, and an argument against leaving `main` stale much longer.

---

## 5. Product-surface impact on production

### Vendor Assurance would arrive UNREACHABLE — the single most important surface finding

Production app runs `SECURELOGIC_RISK_WORKSPACE_ENABLED = "false"`, so
`getNavItems()` returns the **legacy `NAV_ITEMS`** menu. Verified by parsing both
menus from develop source:

| Menu | Entries | `/vendor-assurance` | `/vendor-engagements` |
|---|---|---|---|
| `NAV_ITEMS` (**production renders this**) | 16 | **absent** | **absent** |
| `WORKSPACE_NAV_ITEMS` (**staging renders this**) | 24 | present | present |

Staging runs `RISK_WORKSPACE_ENABLED = "true"`. **Every staging validation of
Vendor Assurance navigation was performed under a menu production does not use.**
After promotion, `/vendor-assurance` and `/vendor-engagements` would exist,
respond, and be entirely absent from production navigation — reachable only by
typing a URL.

This is a decision, not a bug: either accept VA as URL-only in prod initially, or
flip `RISK_WORKSPACE_ENABLED` — which changes the **entire** production menu from
16 to 24 entries in one step, a far larger UX change than shipping VA.

### Ask SecureLogic — reachable, and materially changed

`showGlobalUtilities = isAuthenticated && isPlatformUser` — **not** gated by the
workspace flag. So Ask **is** reachable in production post-promotion for
platform-tier users, appearing as a global header utility rather than a menu item.
Production Ask changes:

- gains a kill switch (it currently has none)
- gains conversation persistence and a recent-conversations rail
- gains an audit trail of tool invocations
- keeps the snapshot retrieval path (`ASK_TOOLS` defaults OFF)
- **inherits the fix for the JSON `/api/ask` 30s timeout** (`1f8da416`) — prod runs
  streaming OFF, which is exactly the configuration that 504'd

### Activates unconditionally, regardless of every flag

**Ask conversation persistence is not flag-gated.** `ask.ts` calls
`createConversation` / `recordUserMessage` / `recordAssistantMessage` on the
normal answer path, best-effort (failures are logged, never fail the answer). On
promotion, production begins **writing customer question and answer text** to
`ask_conversations` / `ask_messages` immediately, with every new flag off. That
is a new class of retained customer data and belongs in the data-protection
review, not in a flag discussion.

### Vendor portal

`/portal/*` pages ship but the engine 404s every portal route with the flag unset,
and `NonPortalChrome` hides app chrome on those paths. Dark, but present.

---

## 6. External dependency impact

Config presence verified live via the Render API (names only, no values read).

| Dependency | Impact | Prod readiness |
|---|---|---|
| **OpenAI** | Voice transcription only. Unchanged by promotion except gaining a kill switch + org governance | Key rotated today; **V1 audio probe still unproven** |
| **Anthropic** | **New consumption paths**: async provenance worker, evidence analysis worker, governed summaries. New per-answer cost | `ANTHROPIC_API_KEY` present on prod engine **and** prod vendor worker ✅ |
| **Resend** | Portal invite emails — dark with the portal | Configured ✅ |
| **Stripe** | No functional change in this delta | Configured ✅ |
| **Redis** | Present on engines only, absent on workers (unchanged) | ✅ |
| **R2 / blob storage** | Portal + engagement evidence uploads | **All five `R2_*` vars ARE present on prod engine and prod worker** — this **closes open pre-deploy check B2**, which the runbook recorded as "not provable from the repository" |
| **Database** | 15 migrations, §3 | Lock exposure unquantified |
| **Workers** | Prod vendor-extraction worker gains **two new job types** (`ask_provenance`, `vendor_evidence_analysis`) and must be redeployed, after the engine widens the CHECK | Needs explicit sequencing |

---

## 7. Staging evidence classification

Unit and integration tests are **not** counted as end-to-end proof.

| Capability | Classification | Basis |
|---|---|---|
| Ask — long-answer async provenance | **PROVEN END-TO-END** | Live staging 2026-08-15: 7,521 chars → 200 in 52.1s, 62 claims attached, delivered text byte-identical at every poll |
| Ask — JSON 504 fix + tool enum fix | **PROVEN END-TO-END** | Real-provider before/after: 504@30s → 200@38s; denied tools 2 → 0 |
| Ask — dotted tool names / streaming quota | **PROVEN END-TO-END** | Real-provider round trip via `/api/ask/stream`, 45.4s, 200 |
| Voice transcription (staging) | **PROVEN END-TO-END** | Post-rotation 200 with transcript; 401 → authenticated |
| **Voice transcription (production)** | **NOT YET PROVEN** | Key rotated + deployed; **zero audio ever posted to prod**; `configured:true` is presence-only |
| Ask — conversation rail (5 recent) | **PARTIALLY PROVEN** | Deployed chunk contains the logic + 20 unit tests; **never observed in a browser** — loads client-side |
| Ask — provenance banners | **PARTIALLY PROVEN** | Confirmed in deployed chunk, not in a browser |
| Vendor Assurance — engagement spine | **PARTIALLY PROVEN** | Migrations applied and probed on staging; **walkthrough legs §1–§3 UNEXECUTED** |
| Vendor Assurance — nav reachability | **NOT YET PROVEN for production** | Proven only under `WORKSPACE_NAV_ITEMS`, which prod does not render (§5) |
| Vendor portal (external) | **NOT YET PROVEN** | Stop Gate B **NOT PASSED**; no real external tester has completed an engagement |
| Agentic Ask (LC-5 / LC-5b) | **TEST-ONLY** | Dark; no staging exercise recorded |
| Realtime voice readback (LC-4) | **TEST-ONLY** | Dark; deferred per the cut rule |
| RLS on 9 vendor tables | **TEST-ONLY** | Proven under `SET ROLE app_request` in the isolation suite; **inert in production** |
| Async provenance purge behaviour | **TEST-ONLY** | Test-covered, explicitly **not live-observed** |
| Evidence analysis worker | **PARTIALLY PROVEN** | Worker ticks cleanly on staging with zero errors; verdict path not walked end-to-end |

---

## 8. Outstanding launch gates

**Stop Gate B — NOT PASSED.** 5 of 7 criteria pass; two need a human:

- **B.3** Independent security review of the portal surface — **open**
- **B.4** A real external tester completes an engagement on staging — **open**

Approved schedule rule: **if portal isolation has not passed by 2026-08-27, apply
the approved portal cut** rather than compressing security. §9 shows that cut is
**not clean as documented**.

Other open operator/human gates:

| Gate | Status |
|---|---|
| Pre-deploy **B2** — prod R2 configuration | **CLOSED by this audit** — all five `R2_*` vars present on prod ✅ |
| Pre-deploy **B1** — freeze legacy `assessments` | **Recommendation stands: drop from the launch.** `assess.ts:159` writes to it; retiring a public API route is a separate decision with a notice period |
| Pre-deploy **B4** — scope-tag curation | **0% curated.** Every tag is `source = 'heuristic'`, derived from requirement titles; no framework expert has reviewed them |
| ASK-C — subprocessor disclosure for audio (OpenAI Whisper) | **Open — operator-owed** |
| ASK-C — C-6 voice sign-off | **Open — operator-owed** |
| Integrated staging walkthrough | **REOPENED.** Both defect P1s closed on live evidence, but §1–§3 legs (portal, SoD, agentic) and all browser observations **UNEXECUTED** |
| Production V1 voice audio probe | **Open — operator-owed** (today's rotation) |
| Revoke the retired shared OpenAI key | **Open — operator-owed**, safe to do now |
| Enterprise Context H2 — graph load test at enterprise fan-out | Open, pre-existing |
| CI status on `develop` HEAD | **Not verifiable from this session** — no `gh` CLI. Must be confirmed before promotion |

---

## 9. Promotion strategy

### The constraint that removes the easy answer

**A clean split is not available.** Commit `648ff0e6` (#788) is a single merge
titled *"VA Phases 1–6 engagement spine + Ask A1–A3"* — Vendor Assurance and Ask
landed **fused**. LC-1 → LC-5b are stacked on one another. Cherry-picking a
"launch-ready subset" means re-deriving a 43,000-line change set by hand, which
carries more risk than it removes.

**And the documented portal cut is not clean either.** The runbook states that
cutting the portal "removes migrations `20260923`/`20260925` from the launch and
leaves the internal engagement workflow intact." **That is false for `20260925`.**
That migration also:

- widens `evidence.source_type` to admit `'vendor_engagement'`, and
- adds `evidence.engagement_id` and `evidence.requirement_id`

Both are consumed by **non-portal** code: `vendorEngagements.ts` (the internal
route), `vendorEvidenceAnalysisWorker.ts`, `vendorAssuranceMonitoringWorker.ts`
and `engagementStateMachine.ts`. Dropping `20260925` breaks the internal
engagement evidence flow. The cut requires **splitting** the migration —
portal-only pieces (`vendor_portal_evidence_comments`, `uploaded_via_invite_id`
and its attribution CHECK) out from the engagement pieces — which is new
migration work, not a subtraction.

### Recommendation: **C — promote in multiple controlled releases**

Not A, and not B as written.

**Why not A (single release).** Not because the code is bad, but because the
delta bundles capabilities at four different evidence levels, and one promotion
would commit all of them at once — including two `ACCESS EXCLUSIVE` migrations on
shared populated tables with no lock timeout, an unexecuted walkthrough, and an
unpassed Stop Gate B. Flags contain *behaviour*; they do not contain *migrations*,
and the migrations are where the irreversible risk lives.

**Why not B as posed.** "A bounded branch containing only launch-ready changes"
assumes launch-ready changes are separable. §9 shows they are not, at acceptable
cost.

**Concretely, C means:**

- **R1 — Foundation + Ask truth (recommended first).** The full delta *minus the
  portal enablement path*, promoted with every new flag unset. Ship the portal
  **code** dark (it is 404'd before any handler) rather than paying to excise it.
  This carries all 15 migrations, so R1 is gated on the migration-lock measurement
  and a maintenance window. Prod gains: Ask kill switch, the 504 fix, conversation
  persistence, VA as URL-only, the seat-model IaC correction.
- **R2 — Vendor Assurance reachability.** Flip `RISK_WORKSPACE_ENABLED` (or add VA
  to the legacy menu) only after the staging walkthrough §1–§3 legs are executed
  *under the production nav variant*.
- **R3 — Vendor portal enablement.** Gated on Stop Gate B.3 + B.4. If not passed by
  2026-08-27, execute the corrected cut from §9 — as a migration-splitting task,
  budgeted as such.
- **R4 — Agentic Ask / streaming / provenance.** Individual flag flips, staged,
  each with its own validation.

The sequencing that matters is **not** "which code ships" — it is "which flag
flips, and in what order, after which evidence." R1 is the only step that carries
migration risk; R2–R4 are flag flips with cheap rollbacks.

---

## 10. PRE-PRODUCTION RELEASE GATE — explicit GO/NO-GO

### Blockers — ALL must clear. Currently **2 open → NO-GO**

> **Update 2026-08-15.** BL-1 and BL-3 are CLOSED; BL-2 and BL-4 remain open and
> both require a human, not a test run. Evidence:
> `docs/validation/bl1-migration-lock-exposure.md`,
> `docs/validation/bl3-suite-verification.md`.
>
> **The promotion candidate has since moved twice** — to `b363e144` (migration
> lock/statement timeout hardening, BL-1's recommended follow-up landed as its
> own commit; independent evidence in
> `docs/validation/migration-timeout-hardening.md`) and then to **`7692c9e6`**
> (the `20260522_alert_preferences.sql` → `20260417_…` rename plus its
> fresh-database regression test; defect write-up in
> `docs/validation/migrate-from-scratch-defect.md`). **The full eight-job suite
> was re-executed at `7692c9e6`** — evidence in
> `docs/validation/bl3-suite-verification.md` §7. The `59d85b18` numbers are NOT
> transferred to it; the re-run stands on its own. Check which SHA you are
> promoting.
>
> **`develop` is 5 commits ahead of `origin/develop` and unpushed.** Everything
> BL-1 and BL-3 now rest on is local only. Push is operator-owned.

| # | Criterion | GO condition | Status |
|---|---|---|---|
| **BL-1** | **Migration lock exposure quantified** | `count(*)` measured on `evidence`, `findings`, `requirements`; `20260925`/`20260928` timed against a production-sized restore; a `lock_timeout` set for the migration run **or** a declared maintenance window accepted | **CLOSED — GO** (`0a3f647b`). ~220 ms total `ACCESS EXCLUSIVE` across all 15 migrations; 2.56 s boot-blocking. **Valid only while production remains empty** — re-measure if promotion slips past the first real data load |
| **BL-2** | **Staging walkthrough executed** | ~~including under `RISK_WORKSPACE_ENABLED=false`~~ — clause RETIRED 2026-08-16 by the target-state reframing; §1–§3 completed under the TARGET configuration | **CLOSED 2026-08-16** — §1 VA end-to-end (incl. external portal legs), §2 all six Ask steps (incl. voice), §3 agentic 10/10. Remnant: the client-rendered conversation rail has never been seen in a browser |
| **BL-3** | **CI green on the promotion SHA** | Full suite verified green (inherited npm-audit red explicitly accepted) | **RE-OPENED then RE-CLOSED at `91a56923`** — the `7692c9e6` run below did NOT hold on develop: isolation was 150/152 files and 1,170/1,175 tests until the two 2026-08-16 defects were fixed. Now 152/152 and 1,175/1,175, plus engine 8,094 / app 1,744 / test:prod 18 / tenant-coverage 260 warn-only. **`91a56923` is pushed, so GitHub Actions can verify it for real — the `7692c9e6` "local reproduction, not the Actions run" limitation is lifted.** Historical `7692c9e6` detail follows: **CLOSED at `7692c9e6`** — the current candidate, re-run in full. Engine **8,074** (496 files) / app **1,738** (133 files) / **isolation 1,169** (151 files) / lint 0 errors / url-drift clean / both builds clean / tenant-coverage 260 warn-only. The isolation increase over `59d85b18` (+2 files, +11 tests) was **accounted for, not assumed** — the two new migration test files run alone give exactly 2 files / 11 tests. `audit` red **verified inherited the stronger way**: `main`'s own lockfile audited via `--package-lock-only` returns the **identical seven** high advisories — and the set is `brace-expansion`, `fast-uri`, `ip-address`, **`js-yaml` (direct)**, `nanoid`, `postcss`, **`undici` (direct)**, not the two named at `59d85b18`. Limitation unchanged: local reproduction, not the GitHub Actions run — and it cannot be, because **the SHA is not pushed** |
| **BL-4** | **VA nav decision made and recorded** | Operator rules explicitly: VA URL-only in prod, **or** flip the workspace nav with its own validation | **CLOSED at `5a669816`** — operator ruled VA a first-class top-level workspace; declared in BOTH nav models, so it survives either flag state |
| **B-5** | **Target-state activation gates** | Under "prod mirrors staging" the LC flags are ON in prod, so the gates that were shielded by dark-shipping must be discharged: Stop Gate B.4 (real external tester), Stop Gate ASK-B (agentic review), ASK-C C-6 (Whisper DPA), C-9 (Ask retention ruling) | **OPEN — GOVERNING.** None closable by code. `ASK_ACTIONS`/`ASK_GOVERNED` are environment-global with no per-org gate, so prod activation is all-or-nothing across every customer |
| **B-6** | **`20260925` narrows `evidence.source_type` — migration can FAIL ON ARRIVAL** | Either prove production holds zero `evidence` rows with `source_type IN ('asset_assessment','finding_risk_acceptance')`, or ship a migration restoring both values | **PARTIALLY CLOSED 2026-08-16 — vocabulary restored at `20261012_evidence_source_type_restore.sql`; the ARRIVAL RISK REMAINS OPEN.** The corrective migration cannot protect the first application of `20260925`, because it sorts AFTER it: on a database holding either value the chain still aborts at `20260925` and `20261012` never runs. **Reproduced** — seeded both values on a pre-`20260925` database, ran the full chain with `20261012` present, `last applied: 20260924_vendor_engagement_scope.sql`. Existing migrations must not be edited, so no later migration can fix this. The remaining gate is an operator pre-flight on production: `SELECT count(*) FROM evidence WHERE source_type IN ('asset_assessment','finding_risk_acceptance')` — 0 means the promotion is safe. Original finding follows. **P0, found by the C-8 rehearsal 2026-08-16.** `20260925` rewrites the CHECK from a stale copy of the list: it adds `vendor_engagement` but silently DELETES `asset_assessment` and `finding_risk_acceptance`, which `20260907` deliberately added ("Evidence for an acceptance attaches as evidence.source_type='finding_risk_acceptance'"). `ADD CONSTRAINT` validates existing rows, so on any database holding one the migration aborts. **Reproduced:** inserting one legal row then applying `20260925` fails with `check constraint "evidence_source_type_check" of relation "evidence" is violated by some row`. The engine's startCommand is `npm run migrate && npm start`, so this does not just fail the migration — **it blocks service start.** Staging survived only because it happened to hold no such row; production is UNVERIFIED and cannot be checked from this repo |

### Conditions — must hold at promotion time

| # | Criterion | GO condition | Status |
|---|---|---|---|
| C-1 | All 8 new flags **unset** on prod engine and app | Verified immediately pre-deploy | ✅ currently unset |
| C-2 | `SECURELOGIC_ASK_VOICE_ENABLED` **not set to `"false"`** in prod | Would silently kill voice at promotion (§4) | ✅ unset |
| C-3 | `SECURELOGIC_VENDOR_PORTAL_ENABLED` unset/false on prod | Verified pre-deploy | ✅ unset |
| C-4 | Deploy order enforced | engine (migrates) → vendor worker → app | Procedural |
| C-5 | Prod vendor worker redeployed to the promotion SHA | Otherwise `ask_provenance` jobs sit pending forever | Procedural |
| C-6 | `ANTHROPIC_API_KEY` on prod vendor worker | Async provenance requires it | ✅ present |
| C-7 | R2 configured on prod | ✅ **verified by this audit** | ✅ |
| C-8 | Rollback rehearsed | Constraints dropped **before** columns; documented per migration | **REHEARSED AND PASSED 2026-08-16** on a fresh database, using the deploy's own `applyMigration`/`listMigrationFilenames`. The claim "documented per migration" was FALSE — no rollback existed; the only text in the repo was one runbook line naming `20260925`/`20260927`, the wrong set. Procedure written at `db/rollback/20260924_20260925_20260928_rollback.sql`. Forward OK over populated data; rollback OK in ONE transaction with no manual repair (deleted 1 finding / 1 evidence / 1 engagement response, remapped 1 `not_applicable`); post-rollback schema equals baseline except two intended deviations (20260927's evidence columns, which are not in scope and correctly survive; and RLS deliberately LEFT ENABLED on `requirement_responses`); pre-existing rows byte-identical; forward re-apply clean back to 223 with schema identical to the first forward; bookkeeping 223→218→223; `lock_timeout` 55P03 at 5,003 ms with zero bookkeeping written and no column left behind, `statement_timeout` 57014 at 1,002 ms, and the rollback itself aborts at 5,125 ms under contention leaving the database untouched. RLS comparison vs a fully-migrated reference: the ONLY tables losing RLS are the three the rollback intentionally drops |
| C-9 | Ask conversation-text retention accepted | New retained customer data, activates unconditionally (§5) | **Needs a data-protection ruling** |

### Explicitly NOT blockers

> **Superseded in part 2026-08-16 — read with B-5.** The first two bullets hold
> ONLY for a dark-shipped promotion (code to `main`, flags off). They are FALSE
> for the reframed target state, in which production mirrors staging and these
> flags are ON. Under that target both bullets invert — see B-5 in the table
> above. Which list applies is decided by the staged/one-shot choice below.

- **Stop Gate B (B.3/B.4)** blocks **portal enablement**, not promotion — the portal 404s before any handler with the flag unset. *(Dark-ship only.)*
- **Agentic Ask / realtime voice** ship dark; TEST-ONLY status is acceptable for unreachable code. *(Dark-ship only.)*
- **RLS migrations** are inert until the `app_request` flip.
- **Production V1 voice probe** and **key revocation** are independent of this promotion.

### Rollback posture

Flags roll back instantly. **Migrations do not.** Twelve are cleanly reversible;
`20260925`, `20260928` and `20260924` require dropping constraints **before**
columns or the rollback itself fails. `20260926`'s backfill is not reversible in
the sense that the pre-backfill values are not retained — it is idempotent and
never overwrites `curated`, but the heuristic tags it writes cannot be
distinguished from hand-curation after the fact except via `scope_tags_source`.

**A promotion is therefore only as reversible as the migration step. That is the
single strongest argument for clearing BL-1 before anything else.**

---

## 11. Post-Stage-1 service hold register (2026-08-16)

Stage 1 promoted `main` to `924abbdf`. To make the approved deploy ORDER
possible, `autoDeploy` was disabled on all ten `main`-tracking services before
the merge (otherwise the merge alone deploys everything at once, demo included),
then restored on the six services that were actually promoted. Four were
deliberately left disabled. This section is the record of that decision so the
state is intentional rather than dashboard drift.

| Service | autoDeploy | SHA | Why held |
|---|---|---|---|
| `securelogic-website` | **false** | `98e97098` | Outside the current release train. Recorded in `render.yaml`. |
| `securelogic-demo-engine` | **false** | `98e97098` | Demo tracks `main`; its database carries unresolved migration drift, so a promotion would apply this release's 18 migrations to it unreviewed. |
| `securelogic-demo-app` | **false** | `98e97098` | As above — demo must move as a pair, and only by explicit decision. |
| `securelogic-intelligence-api` | **false** | `759e7c94`, `update_failed` | Pre-existing failed-update condition since 2026-05-02 — three months before this release and unrelated to it. Pending separate reconciliation. |

### Only ONE of the four can be expressed in `render.yaml`

`render.yaml` declares **fourteen** services. `securelogic-demo-engine`,
`securelogic-demo-app` and `securelogic-intelligence-api` are **not among them** —
they exist only in the Render dashboard and have never been Blueprint-managed.
Their hold therefore cannot be declared in IaC without first ADDING full service
definitions (branch, build/start commands, environment), which would both exceed
the scope of recording a hold and hand the Blueprint control of services it has
never owned. **For those three this table is the only record**, and that is a
statement about the Blueprint's coverage gap, not about the hold.

`securelogic-website` IS Blueprint-managed, so its `autoDeploy: false` is
declared at its service block. Note the pre-existing hazard this closes: the
file had said `true` while the dashboard said `no`.

### Consequence to keep visible

While these four are `false`, pushes to `main` will not deploy them. That is
currently protective — it is what keeps demo from taking the migrations
unreviewed — but it is a silent surprise for anyone who later expects a `main`
push to move the marketing site or demo. Reverse it deliberately, per service.

**No Blueprint sync was performed.** Autosync remains off and the Blueprint
remains paused; this file records intent, it has not been applied.

---

## 12. Wave 1 target-state declaration (B-3) — 2026-08-16

> **SUPERSEDED AS IaC, RETAINED AS THE RECORD — 2026-08-16 (see §15).** The
> values below were reverted out of `render.yaml` on `develop` by the operator
> ruling that **current production Wave 1 state wins** for the next promotion.
> Wave 1 has not been authorized, so the declaration no longer sits in the
> applied artifact where a Blueprint sync could act on it.
>
> **This section is now the sole record of the approved candidate
> configuration.** It remains the target; it is not live IaC. When Wave 1
> receives explicit activation authorization, this table is what gets applied.

Declared, **not activated**. Closes the B-3 finding that the approved target
production configuration existed only as Render dashboard state.

### What is declared

| Flag | Service(s) | render.yaml before | Validated staging | Declared prod target | Wave 1 behaviour it controls |
|---|---|---|---|---|---|
| `SECURELOGIC_RISK_WORKSPACE_ENABLED` | app | `"false"` | `"true"` | `"true"` | Selects `WORKSPACE_NAV_ITEMS` over legacy `NAV_ITEMS` — the workspace IA and row 2 of the approved header. |
| `SECURELOGIC_DASHBOARD_BRIEFING_ENABLED` | engine + app | `"false"` | `"true"` | `"true"` | Relabels the workspace home entry "Briefing"; engine half opens `/api/briefing/layout`. Structurally required by the approved two-row header. |
| `SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED` | engine + app | `"false"` | `"true"` | `"true"` | Shows the "Context" nav entry; engine half serves ECL routes. |
| `SECURELOGIC_ASSET_REGISTRY_ENABLED` | engine + app | `"false"` | `"true"` | `"true"` | Collapses Assets to the unified registry; hides the legacy Vendors / AI Systems children. |
| `SECURELOGIC_DECISION_WORKSPACE_ENABLED` | engine + app | `"false"` | `"true"` | `"true"` | The decision workspace surface. |
| `SECURELOGIC_RISK_ACCEPTANCE_ENABLED` | engine + app | **absent** | `"true"` | `"true"` | Finding risk-acceptance workflow. Key ADDED so the intended value is reviewable. |
| `SECURELOGIC_LEGACY_VENDOR_WRITES_ENABLED` | engine + app | `"true"` | `"false"` | `"false"` | **Removes** the retired point-in-time assess/review write path, making `vendor_engagements` the sole canonical writer. The only flag here that takes a capability away. |

Thirteen declarations across two services. **No staging service was touched**
and no non-env key (branch, command, plan, region) changed.

### Deliberately NOT declared — decision owed

| Flag | Staging | Why excluded |
|---|---|---|
| `SECURELOGIC_FINDINGS_QUEUE_CONTROLS_ENABLED` | `"true"` | Read by `app/src/app/findings/page.tsx`, but **no validation record names it**. An enhancement to the findings queue, not structurally required by the approved nav. Declaring it would infer a product decision. |
| `SECURELOGIC_RISK_ACCEPTANCE_NOTIFICATIONS_ENABLED` | `"true"` | No validation record, and it has a real outbound side effect — enabling it sends email to real customers. Not a presentation flag. |
| `BRIEF_QUALITY`, `FINDING_CLOSURE_GATE`, `SIGNAL_RECENCY` | `"true"` | Staging validation flags. Membership in "the approved experience" was never stated. |
| All Wave 2–5 capability flags | varies | Blocked by open B-5 gates. Not declared at any value. |

Production will therefore differ from staging on those first two even after
Wave 1 activation. That gap is deliberate and needs a ruling, not an inference.

### The hazard this declaration creates — read before resuming the Blueprint

`render.yaml` is the **applied** artifact. It cannot express "intended but not
yet authorized"; only the comments can, and a Blueprint sync does not read
comments. **Once these values reach `main` and anyone syncs the Blueprint,
Wave 1 activates in production** — no further review, by whoever runs the sync.

Two things currently stand between the declaration and that outcome, and both
must hold:

1. **It is committed to `develop`, not `main`.** The Blueprint watches `main`.
   Committing to `main` would additionally have redeployed production, since
   autoDeploy is on for the six promoted services.
2. **Blueprint autosync is off and the Blueprint is paused.**

The next develop→main promotion removes protection (1). Before that promotion,
either Wave 1 must be authorized, or the Blueprint must be confirmed paused with
an explicit owner. Do not treat "it is only IaC" as safe here.

---

## 13. Stage 1 closeout — verified 2026-08-16 11:15Z

Stage 1 landed. This section records the outcome; it does not restate the plan.

**Deployed SHA: `38eb535f`.** `main` advanced past the release commit `924abbdf`
by two IaC/doc commits (`5d41ec46` → `924abbdf` → `38eb535f`), so the SHA
production actually runs is `38eb535f`, not the release commit. All prior
`98e97098` deploys are `deactivated`.

### The six promoted services — all `live` on `38eb535f`

| Service | 924abbdf deploy | 38eb535f deploy (live) |
|---|---|---|
| `securelogic-engine` | 05:43:43Z | **06:56:44Z** |
| `securelogic-vendor-extraction-worker` | 05:45:44Z | **06:56:19Z** |
| `securelogic-posture-worker` | 05:47:19Z | **06:56:28Z** |
| `securelogic-intelligence-worker` | 05:48:43Z | **06:56:22Z** |
| `securelogic-data-rights-worker` | 05:50:05Z | **06:56:20Z** |
| `securelogic-app` | 05:53:45Z | **06:58:26Z** |

**C-4 (deploy order) is verified by the 924abbdf timestamps, not asserted**:
engine → vendor-extraction worker → remaining workers → app, engine first by
2m01s and app last by 3m40s. C-5 is satisfied — the vendor worker is on the
promotion SHA, so `ask_provenance` jobs are serviced.

### Migrations

**Applied successfully.** The engine's `startCommand` is
`npm run migrate && npm start`, so a `live` engine is direct evidence that the
migration chain exited 0; a failure would have held the service out of service,
not degraded it. `/health` returns `{"status":"ok","db":"connected"}`.

**B-6 did not fire.** The operator pre-flight returned 0 rows for
`source_type IN ('asset_assessment','finding_risk_acceptance')` before the merge,
which is the condition under which `20260925` applies cleanly; the live engine
confirms it did.

*Not measured:* the resulting `schema_migrations` count. No production database
credential exists in this environment, so the expected 223 was not read back.

### Probe results

| Probe | Result |
|---|---|
| engine `/health` | `{"status":"ok","db":"connected"}` |
| app `/api/version` | `commit: 38eb535f…`, `branch: main` |
| engine `/api/vendor-portal/session` | **404** — portal unreachable, as designed |

### Stage-2 capability remains dark

No flag was changed at any point in Stage 1. The portal 404 above is the one
piece of behavioural evidence collected; the new dashboard/workspace experience,
Ask agentic actions, governed actions and realtime voice were not probed.

*Limitation, stated rather than glossed:* production environment variables were
**not read back** in this session, so "flags dark" rests on (a) no flag having
been set and (b) that single 404 — not on a config read. A direct read remains
the stronger check and is owed before Stage 2.

### Held services — holds intact

`securelogic-website`, `securelogic-demo-engine`, `securelogic-demo-app` and
`securelogic-intelligence-api` all confirmed `autoDeploy: no` today. No drift
against §11. Their SHAs were not re-probed. Ownership of the three
Blueprint-invisible services is tracked as INF-1 in
`docs/backlog/INFRASTRUCTURE_BACKLOG.md`.

### Rollback status

**Not exercised — and not needed.** Rollback Point A stands as defined in the
release commit: revert code to `98e97098`, leave the additive migrations in
place, change no flag. The rehearsed schema procedure remains at
`db/rollback/20260924_20260925_20260928_rollback.sql`; a schema rollback still
requires separate authorization.

### What Stage 1 does NOT close

B-5 governs Stage 2 and is unchanged by this closeout. Wave 1's target state is
declared in §12 on `develop` only — read §12's hazard note before the next
promotion.

---

## 14. E-1 dark production promotion — executed 2026-08-16 15:11–15:22Z

Tenant Data Governance promoted to production **dark**. Activates nothing.

### Merge

PR **#796** `release/e1-dark` → `main`, **squash-merged**. Resulting production
SHA: **`5e108365936eea5c687d731b3bf93bf6eda895a4`**.

Not a `develop` merge. `develop` carried five commits main lacked; `f19f7059`
(the §12 Wave 1 declaration) was **deliberately excluded**, and `c2179e60` was
not taken because its §13 sits directly on §12 in this file. The branch took
`01a99a70`, `bddc984d`, `27cfcf40` only.

### Deploy discipline and order

autoDeploy was disabled on all ten `main`-tracking services before the merge and
**independently re-read from the API** (6/6 `no`, four holds still `no`) as a
pre-merge gate. The merge itself deployed nothing — engine and app still read
`38eb535f` afterwards. The six were then deployed individually, each `--wait`,
in this order:

| # | Service | Deploy finished |
|---|---|---|
| 1 | `securelogic-engine` (migrates) | 15:13:26Z |
| 2 | `securelogic-vendor-extraction-worker` | 15:14:54Z |
| 3 | `securelogic-posture-worker` | 15:16:11Z |
| 4 | `securelogic-intelligence-worker` | 15:17:26Z |
| 5 | `securelogic-data-rights-worker` | 15:18:29Z |
| 6 | `securelogic-app` | 15:22:06Z |

All six reached `live` on `5e108365`. No service failed, so the stop-rule did
not fire. autoDeploy was then restored on those six and **re-read from the API**
rather than trusted from the update responses: 6/6 `yes`.

### Migrations applied

`20261013_tenant_data_governance`, `20261014_ask_ledger_survives_deletion`,
`20261015_jobs_retention_sweep`, `20261016_ask_conversations_survive_user_deletion`.

The engine's `startCommand` is `npm run migrate && npm start`, so a `live`
engine is the evidence they committed. `/health` → `{"status":"ok","db":"connected"}`.

### Health and smoke results

| Probe | Result |
|---|---|
| engine `/health` | `ok`, db connected |
| app `/api/version` | self-reports `5e108365…`, branch `main` |
| `/api/governance/classes` · `/retention` · `/holds` · `/objects/:class` · `/sweep/:class/preview` | **404** |
| `DELETE /api/governance/objects/:class/:id` · `DELETE /api/ask/conversations/:id` | **404** |
| `POST /api/ask` · `GET /api/ask/conversations` | **401** — reachable and auth-gated, unchanged |
| app `/login` · `/dashboard` | 200 · 307 — same auth gate as before |
| workers | posture cycle completing, intelligence KEV poll completing, vendor-extraction idle-ticking on its own flag, data-rights worker booted clean |
| error-level log entries since deploy | **0** across engine and app |

### TDG dark at process level

The engine's own boot log:

```
"event":"retention_sweep_enqueuer_registered","enabled":false
```

That is the enqueuer reporting the flag state from **inside the production
process** — not inferred from configuration or from a 404.

### `SECURELOGIC_TDG_EFFECTIVE_FROM`

**Not directly read.** Reading service environment variables was not available
in this session. What is on record: it was **never set**; `main`'s `render.yaml`
declares it **empty**; and the first gate is provably closed at process level
(above). A direct read remains operator-owned.

### No retention or deletion execution

A log scan across the engine and all workers for `retention_sweeps_enqueued`,
`retention_sweep_succeeded`, `object_deleted`, `erasure` and
`account_deletion_reap` returned **zero matches**. No reap jobs; the reaper's own
flag is absent in every environment.

### Wave 1 posture on `main`

`main`'s `render.yaml` currently declares every Wave 1 flag **`false`**, with
`SECURELOGIC_RISK_ACCEPTANCE_ENABLED` **absent**. **An accidental Blueprint sync
therefore cannot activate Wave 1 from the current `main`.**

Behavioural confirmation: `/api/enterprise/entities`, `/api/decisions` and
`/api/asset-registry/assets` all **404**. **No environment variable was changed
on any service** during this promotion — only autoDeploy.

### Blueprint

**No Blueprint sync was performed.** Blueprint state itself was **not directly
verified** — the Render CLI exposes no blueprints command. Confirming it remains
paused is operator-owned.

### Explicitly not done

- §3 destructive activation **not executed**.
- `SECURELOGIC_TDG_EFFECTIVE_FROM` **not set**.
- **E-2 / E-3 not started. Stage 2 not started.**
- **Demo untouched** — `securelogic-demo-engine` and `securelogic-demo-app`
  remain `autoDeploy=no` on `98e97098`, alongside `securelogic-website` and
  `securelogic-intelligence-api`. All four holds from §11 intact.

### Squash-merge ancestry caveat — read before the next develop→main reconciliation

The squash gave `main` a **new commit**, so `01a99a70`, `bddc984d` and
`27cfcf40` are **not ancestors** of `main` even though their **content is**.
`git log origin/main..origin/develop` still lists all five commits.

Consequently the next `develop`→`main` promotion will re-present that content
alongside `f19f7059`, and a **`render.yaml` conflict was expected**. That conflict
is where the Wave 1 values re-enter the picture, and it must never be resolved
mechanically — resolving it *is* the Wave 1 decision.

> **RESOLVED IN ADVANCE — 2026-08-16, see §15.** The operator ruled that current
> production Wave 1 state wins. The Wave 1 values have been reverted out of
> `render.yaml` on `develop`, so `develop` and `main` now agree on every
> production env key and the conflict no longer exists. The Wave 1 target is
> retained in §12 as documentation.

---

## 15. Wave 1 IaC reconciliation — 2026-08-16

**Ruling: current production Wave 1 state wins.** `f19f7059`'s Wave 1 `"true"`
values are NOT carried into the promotion candidate. Wave 1 has not been
authorized.

### What differed, and what was resolved

`origin/main` and `origin/develop` differed on **13 environment keys and nothing
else** — no service, branch, plan, region, command or `autoDeploy` difference.
All 13 came from `f19f7059`.

| Service | Flag | Production-authorized | develop (f19f7059) | RESOLVED | Reason |
|---|---|---|---|---|---|
| engine | `SECURELOGIC_DASHBOARD_BRIEFING_ENABLED` | `"false"` | `"true"` | **`"false"`** | Wave 1 unauthorized |
| engine | `SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED` | `"false"` | `"true"` | **`"false"`** | Wave 1 unauthorized |
| engine | `SECURELOGIC_ASSET_REGISTRY_ENABLED` | `"false"` | `"true"` | **`"false"`** | Wave 1 unauthorized |
| engine | `SECURELOGIC_DECISION_WORKSPACE_ENABLED` | `"false"` | `"true"` | **`"false"`** | Wave 1 unauthorized |
| engine | `SECURELOGIC_RISK_ACCEPTANCE_ENABLED` | **absent** | `"true"` | **removed** | Key does not exist in the authorized production state; adding it *is* the change |
| engine | `SECURELOGIC_LEGACY_VENDOR_WRITES_ENABLED` | `"true"` | `"false"` | **`"true"`** | The only Wave 1 flag that REMOVES a capability. Reverting keeps the legacy write path available |
| app | `SECURELOGIC_RISK_WORKSPACE_ENABLED` | `"false"` | `"true"` | **`"false"`** | Wave 1 unauthorized — this is the nav/IA switch |
| app | `SECURELOGIC_DASHBOARD_BRIEFING_ENABLED` | `"false"` | `"true"` | **`"false"`** | Wave 1 unauthorized |
| app | `SECURELOGIC_ENTERPRISE_CONTEXT_ENABLED` | `"false"` | `"true"` | **`"false"`** | Wave 1 unauthorized |
| app | `SECURELOGIC_ASSET_REGISTRY_ENABLED` | `"false"` | `"true"` | **`"false"`** | Wave 1 unauthorized |
| app | `SECURELOGIC_DECISION_WORKSPACE_ENABLED` | `"false"` | `"true"` | **`"false"`** | Wave 1 unauthorized |
| app | `SECURELOGIC_RISK_ACCEPTANCE_ENABLED` | **absent** | `"true"` | **removed** | As above |
| app | `SECURELOGIC_LEGACY_VENDOR_WRITES_ENABLED` | `"true"` | `"false"` | **`"true"`** | As above |

### Unchanged by this reconciliation, and verified so

| Item | State | Note |
|---|---|---|
| `SECURELOGIC_TENANT_DATA_GOVERNANCE_ENABLED` | `"false"` on engine + data-rights worker | E-1 already matched on both refs — it reached `main` via the dark promotion |
| `SECURELOGIC_TDG_EFFECTIVE_FROM` | `""` | The destructive gate. Empty means zero deletions, ever |
| E-2 configuration | **none exists in IaC** | Erasure is database-level and credential-gated; there is no key a sync could set |
| `autoDeploy` holds | `securelogic-website` `false` | Identical on both refs; unchanged |
| Blueprint ownership | 14 services | `demo-engine`, `demo-app`, `intelligence-api` remain dashboard-only (INF-1) |
| Staging service blocks | untouched | Zero staging env changes; staging keeps its validated configuration |

### Blueprint-sync safety proof

Executed against the resolved file, not asserted:

- Wave 1 experience flags **false or absent on every service**.
- `LEGACY_VENDOR_WRITES` still `"true"` on both — the one flag whose Wave 1 value
  would have *removed* a capability.
- TDG flag `"false"` and `TDG_EFFECTIVE_FROM` `""` wherever declared.
- **No erasure key exists in the file at all.**
- `autoDeploy` hold preserved; service count still 14; no dashboard-only service
  adopted.

**Result: a Blueprint sync against the resolved file could not activate Wave 1,
E-1 destructive retention, E-2 erasure, or any other currently unauthorized
capability.** After reconciliation `develop` and `main` agree on **every
production environment key**, so the next promotion carries **zero configuration
change** — code and migrations only.

### What is preserved, and where

The Wave 1 target is **not discarded**. It remains in §12 as the approved
candidate configuration, to be applied when — and only when — Wave 1 receives
explicit activation authorization. It is documentation, not live IaC, which is
precisely the distinction §12's hazard note asked for.

---

## 16. E-1 + E-2 dark production promotion — RELEASE PLAN (prepared 2026-08-16, NOT executed)

**Scope:** E-1 (already in production) plus **E-2 Increments 1–3**, their
supporting fixes, rollbacks and documentation. **Wave 1 remains unauthorized and
is not in this release.**

### 1. Content delta — the commit log is misleading, the tree is not

`git log origin/main..origin/develop` shows **12 commits**, but four of them
(`01a99a70`, `c2179e60`, `bddc984d`, `27cfcf40`) reached `main` by **cherry-pick
during the E-1 dark promotion**, so their content is already there under
different SHAs. `f19f7059` (Wave 1) is present in the log and **must never be
promoted**.

The ancestry-independent truth is the tree diff: **27 files, +6,000 / −17.**
(Corrected 2026-08-17. This line first read "25 files, +5,496" — measured
*before* the commit that wrote this section, `0ee4bca4`, added its own three
files: the Increment-3 rollback script, the full-chain rehearsal, and the
`20261018` rollback edit. The candidate read 27 / +5,995 until this
correction, whose own lines are counted in the +6,000 stated above.)
`render.yaml` appears in it, but its **values are identical to `main`** —
the change is trailing comments only (proven: 311 env keys compared across 14
services, zero differences).

### 2. Migrations production would actually execute — FOUR

`main` carries 228 migration files; `develop` carries 232. The runner keys on
**filename**, and no existing migration was renamed, edited or removed —
verified with `git diff --name-status`, which returns additions only.

| # | Migration | What it does |
|---|---|---|
| 1 | `20261017_worm_guard_consolidation` | Nine WORM tables onto one shared guard; six superseded functions dropped |
| 2 | `20261018_erasure_authorization` | `erasure_agent` (NOLOGIN), `erasure_certificates`, the guard's exception |
| 3 | `20261019_erasure_execution_state` | Scope binding, expiry, attempt state, three SECURITY DEFINER helpers, RLS fail-open fix |
| 4 | `20261020_erasure_actor_revalidation` | Actor revalidation + the platform-row anonymisation exception |

Measured from a rebuilt 228-migration baseline that mirrors production:
**61.6 ms total** (19.8 / 25.4 / 13.6 / 2.7). `schema_migrations` ends at **232**.

### 3. Per-migration risk

| Migration | Locking | Rewrite | Constraints / indexes | Existing-data assumptions | Rollback |
|---|---|---|---|---|---|
| `20261017` | **`AccessExclusiveLock` on 9 tables** for the trigger swap — measured, and the only real lock exposure in this release. Includes `security_audit_log`, which every request writes | None | No index; triggers only | The six named functions and their triggers exist (true — all applied) | `20261017_…_rollback.sql`, rehearsed clean-room |
| `20261018` | New empty table only. **`GRANT` takes no table lock** (measured). `CREATE ROLE` is cluster-level | None | Triggers + CHECKs on a new empty table | `CREATEROLE` privilege (proven — `20260618` created `app_request` the same way, and this applied on staging); `worm_guard_mutation` exists from 17 | `20261018_…_rollback.sql`, refuses while any certificate exists |
| `20261019` | `AccessExclusive` on `erasure_certificates` only — **empty by construction**, created minutes earlier by 18 | None (`ADD COLUMN … NOT NULL DEFAULT 0` is metadata-only in PG11+) | One validated CHECK — full scan of an empty table | `erasure_certificates` exists and is empty | `20261019_20261020_…_rollback.sql` **(new)** |
| `20261020` | `CREATE OR REPLACE FUNCTION` — **no table lock** (measured) | None | None | `users` has `status` and `role` | as above |

**The lock-timeout position:** the runner sets `lock_timeout = 5s` and
`statement_timeout = 300s` per migration transaction. `20261017` therefore
**aborts rather than hangs** if it cannot acquire `AccessExclusiveLock` — the
deploy fails loudly and the old instance keeps serving. Production has had no
organic traffic since 2026-07-03, so contention is unlikely, but the timeout is
the control, not the traffic assumption.

**Rollback chain, rehearsed end to end:** Increment **3 → 2 → 1**, and it
**refuses in both wrong orders** ("2 trigger(s) still reference it";
"role cannot be dropped because some objects depend on it"). After the full
chain, every erasure function is gone, the role is gone, and org deletion raises
again exactly as before E-2.

### 4. Production pre-flight SQL (read-only)

```sql
-- P1a. Baseline count. EXPECT 229, not 228 — see the orphan note below.
SELECT count(*) AS applied FROM schema_migrations;

-- P1b. None of the four pending may already be stamped.
SELECT count(*) AS pending_already_applied FROM schema_migrations
 WHERE filename IN ('20261017_worm_guard_consolidation.sql',
                    '20261018_erasure_authorization.sql',
                    '20261019_erasure_execution_state.sql',
                    '20261020_erasure_actor_revalidation.sql');   -- expect 0

-- P1c. THE CHECK THAT ACTUALLY MATTERS. The count alone cannot distinguish
--      "a harmless historical duplicate" from "a migration file that is
--      missing". Compare both directions against the files on main:
--        * stamped-but-no-file  -> expect EXACTLY ONE: 20260522_alert_preferences.sql
--        * file-but-not-stamped -> expect NONE (anything here would re-apply)
COPY (SELECT filename FROM schema_migrations ORDER BY filename) TO STDOUT;
--      then, locally:
--        git ls-tree --name-only origin/main db/migrations/ | sed 's#db/migrations/##' | sort > main_files
--        comm -23 prod_stamped main_files    # expect: 20260522_alert_preferences.sql
--        comm -13 prod_stamped main_files    # expect: empty

-- P2. The six functions 20261017 replaces must exist, or the DROPs are no-ops
--     and a trigger could be left pointing at nothing.
SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND proname IN
   ('applicability_forbid_mutation','security_audit_log_forbid_mutation',
    'finding_lifecycle_events_forbid_mutation','risk_lifecycle_events_forbid_mutation',
    'retention_policies_forbid_mutation','finding_risk_acceptances_forbid_delete')
 ORDER BY 1;                                                       -- expect 6 rows

-- P3. CREATE ROLE privilege — 20261018 needs it.
SELECT rolcreaterole FROM pg_roles WHERE rolname = current_user;   -- expect true
SELECT 1 FROM pg_roles WHERE rolname='erasure_agent';              -- expect 0 rows

-- P4. Lock contention on the tables 20261017 will swap triggers on.
--     `l.pid <> pg_backend_pid()` is REQUIRED, not tidiness: without it the
--     query counts the AccessShareLocks it is taking on those very tables while
--     it runs, and reports contention that is entirely its own. That produced a
--     false reading of "2" during rehearsal — run P4 ALONE, never folded into a
--     statement that also reads legal_holds or retention_policies.
SELECT c.relname, l.mode, count(*) AS blockers
  FROM pg_locks l JOIN pg_class c ON c.oid=l.relation
 WHERE c.relname IN ('security_audit_log','finding_lifecycle_events','risk_lifecycle_events',
                     'applicability_assessments','applicability_evidence',
                     'applicability_affected_entities','finding_risk_acceptances',
                     'legal_holds','retention_policies')
   AND l.granted
   AND l.pid <> pg_backend_pid()
 GROUP BY 1,2 ORDER BY 3 DESC;                                     -- expect 0 rows

-- P5. E-1 is still dark, and nothing has drifted.
SELECT count(*) FROM retention_policies;                            -- expect 0
SELECT count(*) FROM legal_holds;                                   -- expect 0
SELECT count(*) FROM ask_tool_invocations WHERE message_id IS NULL;  -- expect 0
```

#### The orphaned filename — expected, and why the count is 229

The migration runner keys on **filename**. `7692c9e6` renamed
`20260522_alert_preferences.sql` to `20260417_alert_preferences.sql` so the set
applies in strict order to an empty database. Production had already stamped the
old name, and stamped the new one at Stage 1 — so it carries **one bookkeeping
row with no corresponding file**. This was documented at Stage 1 and proven
harmless there (schema byte-identical before and after, no row loss).

**Production therefore holds 229 stamped rows against 228 files on `main`.** The
count is correct; an expectation of 228 was not.

> **Corrected 2026-08-16.** This rule originally said "expect 228", written from
> the file count without carrying forward the duplicate this document itself
> records. The first execution attempt stopped on that deviation, investigated
> it, and found the rule wrong rather than production drifted. The rule is fixed
> here rather than waived at run time.

**Decision rule (corrected):**

| Check | GO condition |
|---|---|
| P1a | `count(*) = 229` |
| P1b | `0` of the four pending already stamped |
| **P1c** | stamped-but-no-file is **exactly** `20260522_alert_preferences.sql`, and file-but-not-stamped is **empty** |
| P2 | returns `6` |
| P3 | `rolcreaterole = true`, and `erasure_agent` does not exist |
| P4 | no granted locks on the nine WORM tables, or trivially few |
| P5 | `0 / 0 / 0` |

Any deviation is a **STOP**. P1c is the load-bearing one: a raw count can hide a
missing migration behind a harmless duplicate, and only the two-directional
comparison distinguishes them.

#### Pre-flight EXECUTED 2026-08-16 — results

Read-only, against the production database, before any merge or deploy.

| Check | Expected | Observed | |
|---|---|---|---|
| P1a | 229 | **229** | pass |
| P1b | 0 | **0** | pass |
| P1c | one named orphan / none missing | **`20260522_alert_preferences.sql` only / none missing** | pass |
| P2 | 6 | **6** | pass |
| P3 | true, absent | **`securelogic_user`, `rolcreaterole = t`, no `erasure_agent`** | pass |
| P4 | 0 foreign locks | **0** (an initial reading of 2 was this query's own locks — see the note in P4) | pass |
| P5 | 0/0/0 | **0 / 0 / 0** | pass |

**Two supporting facts recorded from the same pre-flight:**

- The production database user is **`securelogic_user` with `rolsuper = f`**.
  Not a superuser — which independently confirms §6-as-corrected: the
  application-as-owner **cannot** `SET SESSION AUTHORIZATION erasure_agent`,
  because that requires superuser. The residual M-1 exposure is `DISABLE TRIGGER`
  alone.
- Production scale: **1 organization, 1 user, 85 `security_audit_log` rows, 0 Ask
  conversations.** The `AccessExclusiveLock` in `20261017` lands on an 85-row
  table with zero concurrent locks, so §3's lock exposure is real in principle
  and negligible in fact for this promotion.

### 5. Candidate verification

**The candidate is `develop` HEAD at the moment of promotion, and its CI must be
confirmed green immediately before the merge.** This section deliberately does
not freeze a SHA: writing one here changes `develop`, which changes the SHA,
which makes the note stale — the plan would be wrong the instant it was
committed.

Verified so far, each on the `develop` HEAD current at the time:

| SHA | Result |
|---|---|
| `3b929bf5` | 7 green, `audit` inherited |
| `0ee4bca4` (this plan + the Increment 3 rollback) | 7 green, `audit` inherited |

`audit` is red on both and on `main` itself — the same seven inherited
advisories, and **no dependency file appears in the delta**, so it is not
attributable to this release.

Locally, on the same content: unit **503 files / 8,193 passed**, isolation
**191 passed**, fresh Postgres **232 migrations** in strict order, **three**
rollback rehearsals passed (Increment 1, Increment 2, and the full 3→2→1 chain),
and the `[SEED]` lifecycle rehearsal passed.

**Pre-merge check:** re-run the §1 tree diff and the §6 configuration proof
against the actual candidate before merging. Both are scripted comparisons, not
judgement calls, and both take seconds.

### 6. Configuration safety

Wave 1 flags **false or absent on every service**; `LEGACY_VENDOR_WRITES` still
`"true"`; TDG flag `"false"` and `SECURELOGIC_TDG_EFFECTIVE_FROM` `""`; **no
erasure key exists in IaC at all**; `autoDeploy` holds unchanged; 14 services
with the three dashboard-only ones still unowned. A Blueprint sync against this
file could not activate anything unauthorized.

### 7. Erasure remains impossible after migration

Verified on the migrated baseline: **`erasure_agent.rolcanlogin = false`**. No
erasure credential exists in `render.yaml`, `.env.example`, or any code path —
nothing reads an erasure DSN. Increment 4 is the only thing that changes this,
and it needs its own authorization.

### 8. Controlled deployment order

**A plain `develop` → `main` merge CONFLICTS** — five files, because the E-1
content reached `main` by cherry-pick and git sees independent adds. Use the
proven release-branch approach:

```
git checkout -b release/e1-e2-dark origin/main
git checkout origin/develop -- $(git diff --name-only origin/main origin/develop)
git commit    # verify: git diff --cached origin/develop  ->  EMPTY
```

This was executed as a dry run: the resulting tree is **byte-identical to
`develop`**, and the diff against `main` is exactly the 27-file delta.

Then, per Stage-1 discipline:

1. `autoDeploy=false` on **all ten** `main`-tracking services; **re-read from the
   API** to confirm 6 of 6 off and the four holds intact.
2. Merge the release PR (squash). Confirm it deployed nothing.
3. **Engine first** — it migrates. Validate: `/health` db connected; governance
   routes 404; `POST /api/ask` 401; `erasure_agent` still NOLOGIN.
4. Workers: vendor-extraction → posture → intelligence → **data-rights last**
   (it is the only worker carrying E-2 code).
5. **App last.** Dependency analysis: E-2 adds no app code and no new app→engine
   call, so no other order is required.
6. Restore `autoDeploy` on the six; **re-read from the API** to confirm.
7. Post-deploy proof: SHA on all six, migrations applied, TDG dark, erasure
   unreachable, Wave 1 unchanged, no new P0/P1.

**Stop rule:** if any service fails validation, stop at that service. Do not
continue deploying downstream to complete the release.

### 9. Rollback

**Rollback Point A (code).** Revert the six promoted services to `5e108365`,
leave all four migrations applied, change no flag. Safe because every one is
additive and the capability is inert: the WORM consolidation is
behaviour-identical, and the erasure mechanism cannot act without a credential.
**This is the expected rollback.**

**Schema rollback is a different act and is NOT part of an operational
rollback.** It requires separate authorization, runs `3 → 2 → 1`, and each script
refuses out of order or while evidence exists (certificates, sweep jobs,
orphaned ledger rows). Rehearsed clean-room, never against production-shaped
data.

**Not reversible at all:** nothing in this release destroys data, so there is no
data rollback to define. That property is what makes Rollback Point A
sufficient.

### 10. What would make this NO-GO

| Condition | Status |
|---|---|
| Any pre-flight query deviates (§4 corrected decision rule) | **Clear — executed 2026-08-16, all seven checks pass**. Re-run immediately before the merge |
| `rolcreaterole = false` on the production database user | **Clear — `securelogic_user`, `rolcreaterole = t`** |
| Wave 1 values present in the candidate | **Clear** — 311 keys compared, zero differences |
| `SECURELOGIC_TDG_EFFECTIVE_FROM` non-empty anywhere | **Clear** |
| An erasure credential existing in IaC or env | **Clear** — none exists |
| CI red on the candidate beyond inherited `audit` | **Clear** |
| Lock contention on the nine WORM tables at deploy time | **Clear at pre-flight — 0 granted locks.** Re-check at P4 immediately before the merge |
| A migration edited or renamed rather than added | **Clear** — additions only |
| Demo or the four `autoDeploy` holds disturbed | **Clear** — untouched |
