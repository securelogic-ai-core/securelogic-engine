# ASK-C — Voice Data Governance Gate (formalized checklist)

Status: **FORMALIZED 2026-08-13 (LC-4).** This document turns the ratified
Stop Gate ASK-C (`sept15-stop-gate-ask-c-evidence.md`) into an explicit,
testable, evidentiary checklist. It does not reopen the gate's existence or
its prior PASS findings — it operationalizes them and extends coverage to the
operator's eleven mandated dimensions. Where a dimension was already reviewed,
the prior evidence is cited; where it was not, the audited gap and its LC-4
disposition are recorded.

Scope of "voice" at this revision:

```
browser mic (explicit press) → app /api/transcribe (iron-session proxy)
  → engine POST /api/ask/transcribe (OpenAI Whisper, discrete clip) → text
  → the ORDINARY Ask path (same tools, same authorization, same ledger)
  → [LC-4] streamed answer (LC-3 SSE) → optional browser-local spoken readback
```

Voice has **no retrieval path, storage path, or authorization of its own**:
the transcript enters the system exactly as a typed question. That structural
fact is what most of this checklist inherits from.

---

## The checklist

Each item: **Requirement** (normative) · **Evidence** (how it is proven,
re-runnable) · **Status at LC-4 audit** · **Disposition**.

### C-1. Tenant enablement / disablement

- **Requirement**: an organization admin can disable voice input for their
  tenant; the engine refuses transcription for a disabled tenant regardless of
  client behavior; the control is auditable.
- **Evidence**: `organizations.voice_input_enabled` column;
  PATCH `/api/org/settings` allow-list; engine 403 `voice_disabled_for_org`
  on the transcribe route; `org.settings_changed` audit event on flips;
  route tests in `askVoiceGate.test.ts`.
- **Status at audit**: **GAP** — no per-tenant control existed (global
  `OPENAI_API_KEY` presence was the only switch).
- **Disposition**: **closed by LC-4** (migration `20261001`, default `true` to
  preserve live behavior; disablement is the admin's act, not a deploy).

### C-2. Explicit user disclosure before voice use

- **Requirement**: before the first recording, the user is told in plain
  language that audio is sent to OpenAI for transcription, is not stored by
  SecureLogic, and that the transcript becomes their Ask question. The
  disclosure is shown before capture ever starts, not after.
- **Evidence**: first-use disclosure card in `AskClient` — the mic's first
  press renders the disclosure with an explicit Continue; capture cannot start
  until acknowledged (latched per browser); unit tests on the latch logic.
- **Status at audit**: **GAP** — no disclosure existed anywhere in the UI.
- **Disposition**: **closed by LC-4**.

### C-3. Microphone / session consent behavior

- **Requirement**: capture starts only on an explicit user action; the browser
  permission prompt (getUserMedia) is the second, OS-level consent; denying it
  produces a clear, recoverable message; no capture attempt happens on page
  load or in the background.
- **Evidence**: `toggleRecording` is reachable only from the mic button
  (`AskClient.tsx`); `NotAllowedError` → `microphone_denied` messaging;
  capability detection (`voiceSupport.ts`) never requests permission — it
  reads API presence only.
- **Status at audit**: **PASS** (verified in code; permission-denied path has
  dedicated handling and diagnostics).
- **Disposition**: held; covered by existing voice tests + C-2's latch test.

### C-4. No silent recording

- **Requirement**: recording state is always visibly indicated; stopping the
  recorder releases the microphone (tracks stopped) immediately; no path
  records without the indicator.
- **Evidence**: `isRecording` renders the mic red with "Stop recording"
  aria-label; `onstop` calls `stream.getTracks().forEach(t => t.stop())`
  (`AskClient.tsx`); the only `MediaRecorder.start()` call site is inside
  `toggleRecording`.
- **Status at audit**: **PASS** (single capture path, indicator bound to the
  same state that gates it).
- **Disposition**: held.

### C-5. Transcript creation, storage, retention, deletion

- **Requirement**: raw audio is never persisted anywhere; the transcript is
  persisted only when it becomes an Ask question, at which point it inherits
  the text path's storage, user-scoping, GDPR classification, retention and
  deletion semantics in full — voice must never acquire a divergent store.
- **Evidence**: `multer.memoryStorage()` + no disk/blob/DB write in
  `transcribe.ts` (ratified PASS); transcript lands in `ask_messages` via the
  ordinary submit; `ask_conversations.mode` already distinguishes
  `'voice'` for provenance without a parallel table.
- **Status at audit**: **PASS** (ratified; re-verified at this revision).
  Note: Ask conversations currently have no user-facing deletion, and
  platform-wide tenant erasure is blocked by the known WORM/FK issue (D-12).
  Both are **text-Ask facts that voice inherits equally** — equivalence holds,
  which is what this gate requires. D-12 remains tracked outside this gate.
- **Disposition**: held.

### C-6. Provider / subprocessor data handling

- **Requirement**: every third party that receives voice data is named,
  the data sent is minimized (audio clip only, no org identifiers beyond the
  platform API key), and the DPA/subprocessor listing covers audio processing.
- **Evidence**: OpenAI Whisper (`whisper-1`) is the sole recipient, under the
  platform key (`transcribe.ts`); nothing else receives audio — the LC-4
  readback is **browser-local SpeechSynthesis** (no audio leaves the device).
- **Status at audit**: engineering **PASS** (single disclosed recipient,
  minimized payload); **operator sign-off on the DPA/subprocessor listing
  remains OWED** — this is the ratified gate's pre-existing human item,
  restated here verbatim, not a new decision. Voice degrades cleanly if the
  operator instead disables it (C-1/C-9 now make that a switch, not a deploy).
- **Disposition**: held (engineering); **operator-owed** (sign-off).

### C-7. Authorization equivalence with text Ask

- **Requirement**: every gate on the text Ask path gates voice identically —
  kill switch, API key, org context, entitlement, seat policy, rate limiting.
  A caller who cannot ask by text must not be able to spend voice processing.
- **Evidence**: middleware-chain parity test (`askVoiceGate.test.ts`) asserting
  the transcribe chain enforces: `askFeatureFlag` (Ask kill switch) →
  `requireApiKey` → `attachOrganizationContext` → `requireEntitlement
  ("premium")` → `denyContributor()` → org-keyed rate limit.
- **Status at audit**: **GAP ×2** — the transcribe route lacked
  `askFeatureFlag` (the Ask kill switch did NOT kill voice) and lacked
  `denyContributor()` (a contributor seat could spend Whisper calls it could
  never turn into a question). Entitlement, org context, and the org-keyed
  limiter (fixed in the ratified session) already matched.
- **Disposition**: **closed by LC-4**.

### C-8. Audit logging

- **Requirement**: each transcription is an auditable per-org event carrying
  the fact and shape of processing (sizes, outcome, correlation id) and never
  the content — matching the Ask precedent that answers stay out of the audit
  log.
- **Evidence**: `ask.voice.transcribed` audit event on every successful
  transcription (`transcribe.ts`), payload = audio size, mime, transcript
  length, correlation id; content excluded by construction; asserted in
  `askVoiceGate.test.ts`.
- **Status at audit**: **GAP** — diagnostics went to the logger only; the
  audit ledger had no record that a user's audio was ever processed.
- **Disposition**: **closed by LC-4**.

### C-9. Independent voice kill switch

- **Requirement**: voice can be disabled platform-wide independently of Ask
  (Ask keeps working when voice is killed), by flag, with no deploy.
- **Evidence**: `SECURELOGIC_ASK_VOICE_ENABLED` — kill-switch semantics
  (default ON, only the literal `"false"` disables; voice is live in prod, so
  default-off would silently remove shipped behavior — same reasoning as
  `SECURELOGIC_ASK_ENABLED`); gates the transcribe route (404) and the app
  mic; flag tests in `askVoiceGate.test.ts`.
- **Status at audit**: **GAP** — no voice-specific switch existed; the only
  lever was removing `OPENAI_API_KEY` (a credential change, not a control).
- **Disposition**: **closed by LC-4**.

### C-10. Graceful fallback to text

- **Requirement**: every voice-unavailable state (unsupported browser, denied
  permission, killed flag, disabled tenant, provider failure) leaves typed Ask
  fully working with a clear "type instead" path; voice failures never break
  the question flow.
- **Evidence**: capability detection hides the mic with the typed-input note
  (`voiceSupport.ts`); every transcribe error maps to a friendly message with
  typed fallback (`TRANSCRIBE_ERROR_MESSAGES`); LC-4 adds the same for
  `voice_disabled_for_org` / kill-switch 404; readback failure is silent
  (text answer already rendered).
- **Status at audit**: **PASS** for existing states; new states (C-1/C-9)
  covered by LC-4 with the same pattern.
- **Disposition**: held + extended by LC-4.

### C-11. Cross-tenant / session isolation

- **Requirement**: voice processing is stateless per-request; nothing about
  one org's audio, transcript, or rate budget is observable by another; the
  transcript's storage isolation is the Ask path's (already isolation-tested).
- **Evidence**: transcribe holds audio in request memory only and writes no
  rows; the rate limiter keys on the caller's org (ratified fix); transcript
  storage inherits `ask_conversations`/`ask_messages` scoping, covered by the
  isolation harness; org enablement reads the caller's own org row only.
- **Status at audit**: **PASS** (ratified + inherited).
- **Disposition**: held.

---

## Realtime scope ruling at LC-4 (inherited from the ratified gate)

The ratified gate deferred "realtime voice" defined as **duplex transport +
realtime provider integration**, and required that shape to get *its own
review of what a live audio stream may trigger*. LC-4 honors that boundary:

- **In scope (no new data class):** the realtime conversation LOOP — explicit
  press-to-talk clip → Whisper (existing, sole, disclosed subprocessor) →
  LC-3 streamed answer → **browser-local** spoken readback (SpeechSynthesis;
  no audio leaves the device; no new provider). Ships dark behind
  `SECURELOGIC_ASK_VOICE_REALTIME_ENABLED` (default OFF — new behavior, not a
  kill switch).
- **Out of scope, decision-gated (unchanged from the ratified gate):**
  continuous/full-duplex audio streaming to any provider. That is a new
  subprocessor data-handling class and stays behind its own future review.
  Nothing in LC-4 forecloses it.

**Gate determination for LC-4**: implementation may proceed. Every dimension
is PASS, closed-by-LC-4, or explicitly operator-owed (C-6 sign-off — the
pre-existing ratified item, unchanged). No new P0/P1 policy decision is
required by this scope.
