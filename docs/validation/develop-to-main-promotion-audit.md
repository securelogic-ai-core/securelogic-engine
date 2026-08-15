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
| **BL-2** | **Staging walkthrough executed** | §1–§3 legs completed by a human in a browser, **including under `RISK_WORKSPACE_ENABLED=false`** to match production nav | **OPEN** — REOPENED, legs unexecuted |
| **BL-3** | **CI green on the promotion SHA** | Full suite verified green (inherited npm-audit red explicitly accepted) | **CLOSED at `7692c9e6`** — the current candidate, re-run in full. Engine **8,074** (496 files) / app **1,738** (133 files) / **isolation 1,169** (151 files) / lint 0 errors / url-drift clean / both builds clean / tenant-coverage 260 warn-only. The isolation increase over `59d85b18` (+2 files, +11 tests) was **accounted for, not assumed** — the two new migration test files run alone give exactly 2 files / 11 tests. `audit` red **verified inherited the stronger way**: `main`'s own lockfile audited via `--package-lock-only` returns the **identical seven** high advisories — and the set is `brace-expansion`, `fast-uri`, `ip-address`, **`js-yaml` (direct)**, `nanoid`, `postcss`, **`undici` (direct)**, not the two named at `59d85b18`. Limitation unchanged: local reproduction, not the GitHub Actions run — and it cannot be, because **the SHA is not pushed** |
| **BL-4** | **VA nav decision made and recorded** | Operator rules explicitly: VA URL-only in prod, **or** flip the workspace nav with its own validation | **OPEN** |

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
| C-8 | Rollback rehearsed | Constraints dropped **before** columns; documented per migration | **Not rehearsed** |
| C-9 | Ask conversation-text retention accepted | New retained customer data, activates unconditionally (§5) | **Needs a data-protection ruling** |

### Explicitly NOT blockers

- **Stop Gate B (B.3/B.4)** blocks **portal enablement**, not promotion — the portal 404s before any handler with the flag unset.
- **Agentic Ask / realtime voice** ship dark; TEST-ONLY status is acceptable for unreachable code.
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
