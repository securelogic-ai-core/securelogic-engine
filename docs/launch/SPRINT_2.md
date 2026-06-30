# Sprint 2 — First Post-Launch Hardening

> **Status:** QUEUED — not started, **not authorized**. Begins only after Sprint 1 promotes to production.
> **Theme:** Activate the paths that ship inert at launch, fix the few customer-visible inconsistencies, and confirm the production posture of already-shipped systems.
> **Authorization note:** Each item below is a **fresh active-package decision** under `BUILD_SEQUENCE.md`. This document orders and scopes the work; it does not authorize it. Build one package at a time.

---

## Objective

At launch, several systems ship deliberately **inert** (flag-gated or unwired) and a handful of customer-visible labels are known-stale. Sprint 2 turns on the highest-value inert path, removes the visible inconsistencies, and confirms the live production posture of shipped-but-gated systems — without expanding scope.

---

## Work items (priority order)

### 2.1 — Export-delivery email (GDPR PR #4) — **highest-value lever**
**Why:** The GDPR/CCPA export path is shipped and prod-verified, but exports are **inert end-to-end** because no delivery email is sent. A requester gets no link. This is the single change that makes the data-rights feature actually usable.
**Scope:**
- Email the tokenized download link minted by the worker (`data_export_files` row + token already exist).
- Use a **shared `sendEmail()`** — do **not** create a new Resend sender silo (Decision E).
**Done when:** a self-export request results in a delivered email with a working, expiring download link; negative paths (expired token, wrong user) verified.
**Hard rule:** no new Resend sender; reuse the shared sender.

### 2.2 — In-app price-label reconciliation
**Why:** App surfaces carry stale prices that contradict the corrected commercial model (e.g. BriefCard, UpgradeCard, the `/pricing` route). This is **display-label only** — Stripe prices and Price IDs are owned by the operator and must not be touched.
**Scope (DISPLAY LABELS ONLY):**
- Sync in-app price labels to the launch model: Brief Pro $49/mo, Team Professional $199/mo, Platform Professional $800/mo, Platform Professional Annual $7,200/yr.
- Retire or correct any `/pricing` route values that no longer match.
**Done when:** every in-app price label matches the authoritative model in `LAUNCH_MASTER_PLAN.md` §1.
**Hard rules:** do not change any Price ID, checkout routing, or Stripe configuration. Labels only. Operator sets Stripe prices first; this is the follow-on display pass.

### 2.3 — Vendor-assurance production-enablement confirmation
**Why:** The Pillar-1 vendor-assurance extraction worker is shipped and staging-validated behind `SECURELOGIC_VENDOR_ASSURANCE_ENABLED`, but full **production** enablement (prod flag flip + prod R2 + `ANTHROPIC_API_KEY` placement on the engine web service) is an operator/dashboard action **not provable from the repo**.
**Scope:**
- Confirm (or perform, operator-side) prod flag state, prod R2 wiring, and `ANTHROPIC_API_KEY` placement.
- Record the determination in `KNOWN_ISSUES.md` (currently UNKNOWN-from-repo).
**Done when:** the production state of vendor-assurance is verified and documented (enabled-and-working, or intentionally-off).

### 2.4 — Vendor-surface entitlement gate flip (deferred Step-5)
**Why:** Three vendor-adjacent route files (`vendorAssessments.ts`, `vendorReviews.ts`, `findings.ts`) remain at rank-2 `requireEntitlement("standard")`. UIs redirect rank-2 users, but a direct API-key caller still reaches these APIs at rank-2. Known, deliberate boundary — flip to `premium` to close it.
**Scope:** flip the three routes to the correct premium entitlement; verify negative-path (rank-2 caller → 402/403).
**Done when:** the three routes enforce premium and a rank-2 direct API caller is rejected.
**Dependency:** sequence after 2.3 so the vendor-assurance prod posture is settled first.

### 2.5 — Brand-asset swap
**Why:** Launch uses an **approved interim** icon-only PNG mark. The official brand SVG + favicons are a post-launch cosmetic swap, explicitly **not** a launch blocker.
**Scope:** replace interim PNG with official brand SVG lockup + favicons across website/app; review old engine/app lockups separately.
**Done when:** official brand assets are live and the interim PNG is removed.
**Hard rule:** cosmetic only — no IA, copy, or layout changes bundled in.

---

## Ask SecureLogic & Voice reliability (operator-directed addendum)

> Added after the original 2.1–2.5 scope at operator direction. This workstream hardens the existing **Ask SecureLogic** assistant (`/ask`) and its voice input ahead of launch. It is **product-knowledge + UX reliability only** — it touches no billing, Stripe, checkout, pricing, migrations, `render.yaml`, feature flags, `main`, or production. Shipped to `develop` as scoped PRs: Ask product-knowledge (A-1, PR #419) and the iPad voice gate (A-2, PR #418), then voice **diagnostics** (A-3, PR #420).
>
> **Voice is NOT resolved.** A-1 (product-knowledge) is done. The iPad/iOS voice failure is **still undiagnosed** — the blanket iOS gate (A-2) is a **temporary** safe default, not a fix, and a **Voice Diagnostic Workstream** (A-3, below) must produce evidence before the final launch decision on voice.

### A-1 — Ask product-knowledge (so Ask can answer "How do I add a vendor?")
**Problem:** Ask was a data-only assistant — its prompt answered strictly from the org's live posture snapshot (8 DB queries) and had **no** product documentation, route metadata, feature metadata, or workflow guidance. Platform how-to questions ("How do I add a vendor?", "Where's my Intelligence Brief?") returned "no data available" because the prompt forbids inventing facts not in the context.
**Fix (shipped):** added a curated, static **product-knowledge source** (`src/api/lib/productKnowledge.ts`) grounded in the real UI navigation and engine routes, injected into the Ask system prompt, plus guardrails that (a) answer product/how-to questions from product knowledge first, (b) forbid claiming "no access" when the product-knowledge answer exists, and (c) re-scope the no-invented-data rule to organization data only — while still grounding *data* questions in the org context.
**Done when:** Ask answers core platform how-to questions accurately; tests assert the knowledge content and prompt assembly. Verified on staging.

### A-2 — Temporary iPad/iOS voice gate (NOT a fix)
**Problem:** voice transcription was reported failing on iPad. The cause was **not** diagnosed.
**Action (shipped):** a **precautionary** capability + iPadOS detector (`app/src/app/ask/voiceSupport.ts`) hides the mic button on production iPad/iOS and shows "Voice input is not yet supported on this browser. Please type your question instead." This is a **temporary safe default**, not a resolution — it does not explain or fix the failure. See `KNOWN_ISSUES.md` D-10 and A-3 below.
**Status:** open. The gate stays until A-3 produces evidence.

### A-3 — Voice Diagnostic Workstream (DIAGNOSED — cause B; fix shipped to develop)

**Objective.** Determine the **actual** root cause of iPad/iOS voice failure from one real attempt, so we can make an evidence-based launch decision — fix our code, accept a platform limit, or defer to a different approach. Replace assumption with data.

> **RESULT (cause B — our implementation).** A real attempt produced `VOICE-DIAG … sel=audio/webm rec=audio/webm; codecs=opus blob=…/115417B http=415 code=unsupported_media_type`. The device recorded valid audio (115 KB webm/opus); the `415` came from the global **content-type enforcement guard** in `src/api/app.ts`, whose exemption list **omitted `/api/ask/transcribe`** — so multipart audio was rejected before reaching the route (the engine's own transcribe diagnostics never fired). This broke voice on **every** browser, not just iPad. **Fix shipped to `develop`:** `/api/ask/transcribe` added to the exemption list (extracted to the tested `contentTypeAllowlist.ts` predicate) + transcribe `fileFilter` now matches the base MIME. **Next:** confirm an iPad `http=200 code=ok` on staging, then a follow-up re-enables iOS voice (per the decision rule below); the production iOS gate stays until that confirmation.

**Current known facts.**
- The earlier "WebM-only / iOS mp4 unsupported" explanation was **not evidence-based** and is withdrawn: the client already falls back to `audio/mp4`, the engine allow-lists `audio/mp4`/`audio/x-m4a`/`.mp4`/`.m4a`, and Whisper accepts AAC-in-MP4. A simple format mismatch is **not** a proven cause.
- Staging engine **has** an OpenAI key (`GET /api/ask/transcribe/status` → `{"configured":true}`), so a missing-key config is **not** the cause on staging.
- Candidate causes remain open: **A** platform/browser capability · **B** our MIME/blob/filename handling · **C** empty/short capture · **D** transcription-endpoint rejection · **E** mic permission · **F** OpenAI/Whisper rejection.

**What the diagnostic captures (PR #420, non-sensitive — no audio, secrets, or PII).**
- Client (`app/src/app/ask/voiceDiagnostics.ts`): per-attempt capability result, selected mimeType, `MediaRecorder.mimeType`, `blob.type`/`size`, filename extension, upload HTTP status, error stage + code. Surfaced in-UI as a `VOICE-DIAG …` line and `console.error`'d.
- Correlation id (`x-voice-diagnostic-id`) threaded **browser → app proxy → engine**.
- Engine (`src/api/lib/voiceTranscribeDiagnostics.ts`, `routes/transcribe.ts`): classifies the outcome, captures multer format/size rejects that previously bubbled to an opaque 500, detects 0-byte audio, and emits one `voice_transcribe_diagnostic` log line with the same correlation id.
- **Staging/local only**, the iOS gate is bypassed (diagnostic mode, `isStagingHost`) so an iPad can attempt voice and surface the failure. **Production keeps the gate.** No env/flag/`render.yaml` change.

**Operator testing steps.**
1. On an **iPad**, open `https://securelogic-app-staging.onrender.com/ask` in Safari and sign in with a **Platform/premium** account (Ask + transcribe require `premium`).
2. The **Voice** mic button appears (staging diagnostic mode). Tap it, allow the mic, speak ~3s, tap **Stop**.
3. On failure, expand **"Diagnostic details (share with support)"** and screenshot the `VOICE-DIAG …` line; note the `cid=`.
4. In Render → **`securelogic-engine-staging`** → **Logs**, filter for `voice_transcribe_diagnostic` (or the `cid`) and capture the matching JSON line.

**Required evidence (both, sharing one correlation id).**
- One **`VOICE-DIAG` browser line** (from the iPad).
- The **matching engine `voice_transcribe_diagnostic` log line** with the **same `cid`**.

**Interpretation table.**

| Code / outcome | HTTP | Meaning | Candidate cause |
|---|---|---|---|
| `voice_unsupported` (stage `capability`) | — | MediaRecorder/getUserMedia unavailable or constructor threw | **A** real platform limit |
| `microphone_denied` (stage `permission`) | — | user denied mic access | **E** permission |
| `no_audio` (stage `capture`, `blob=…/0B`) | 400 | recording produced 0 bytes | **C** empty/short capture |
| `unsupported_audio_type` | 415 | engine rejected the format/extension | **B/D** (note: allow-list already includes mp4/m4a) |
| `empty_audio` | 400 | file reached engine but 0 bytes | **C** |
| `file_too_large` | 413 | recording > 10 MB | **C** oversized |
| `openai_error` | 500 | Whisper rejected the iOS file | **F** OpenAI/Whisper |
| `ok` | 200 | transcription succeeded | none — gate is over-cautious |

**Decision rule (apply once evidence is in).**
- **Valid audio + transcription succeeds (`ok`)** → re-enable voice on capable iOS browsers (narrow the gate to genuinely incapable ones).
- **Failure is MIME/blob/filename handling (B)** → fix our implementation, then re-enable.
- **Failure is OpenAI/Whisper rejection (F)** → document it and decide whether to support iOS voice later via the **Realtime API** (out of scope now).
- **Real browser capability limit (A)** → keep the fallback gate.

**Launch rule.**
- **Text Ask remains launch-critical** and is unaffected by any of this.
- **Voice is launch-optional** unless we advertise it as supported.
- If voice is **not fully validated** by launch, it must be labelled **Beta** or hidden behind capability detection (the current production behavior).

**Done when:** an iPad `VOICE-DIAG` line + matching engine log are captured, the cause is classified per the table, and the decision rule is applied (re-enable / fix / defer / keep gate). Until then this item stays **open**.

---

## Out of scope for Sprint 2 (→ Sprint 3)

- A04-G1 `app_request` RLS flip (cross-cutting infrastructure, high blast radius).
- GDPR deletion reaper (Art. 17 erasure — destructive, heavy Phase-0).
- Priority-4 signal-ingestion hardening 4B/4C/4D (source qualification, clustering, provenance).
- Rate-limiter Redis migration, cross-region worker re-provisioning, demo-environment promotion.

---

## Definition of done (Sprint 2)

- 2.1 shipped and prod-verified (the data-rights feature is now usable end-to-end).
- 2.2 in-app labels match the authoritative model.
- 2.3 vendor-assurance production posture documented.
- 2.4 vendor route gate boundary closed (or explicitly re-deferred with rationale).
- 2.5 official brand assets live.
- `KNOWN_ISSUES.md` updated to reflect every closed item.
