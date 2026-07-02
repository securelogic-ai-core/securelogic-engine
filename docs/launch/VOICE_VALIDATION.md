# Voice Validation

> **Canonical evidence record** for SecureLogic AI **Ask voice** transcription. This file is **evidence, not design** — the design, decision rules, and launch rules live in `SPRINT_2.md` → **Voice Diagnostic Workstream (A-3/A-4)**.
> **Status:** ❌ **NOT yet validated for production.** The server pipeline is fixed and proven (automated tests + staging HTTP checks), but the **live browser matrix below is pending operator capture.** No browser is marked Supported without a captured PASS.
> **Maintenance rule:** every voice fix appends a row to **Regression History**; every validation run fills the **Browser Matrix** + **Successful Run Evidence**; every failure is recorded under **Failure Evidence** with root cause, fix, and PR.

---

## Objective

Verify that Ask voice transcription works correctly on every supported browser **before** production promotion. Passing this validation is **required** before voice is considered production-ready. Until then voice is launch-optional and gated by capability detection (it hides gracefully where unsupported).

---

## Test Environment

Record per validation run:

- **Date:**
- **Operator:**
- **Build SHA:**
- **Environment:** (staging)
- **Browser version:**
- **OS version:**

> Staging build at time of authoring this record: engine + app on `04f01eba` (`securelogic-engine-staging` / `securelogic-app-staging`). Engine `GET /api/ask/transcribe/status` → `{"configured":true}`.

**How to capture (per browser):** open `https://securelogic-app-staging.onrender.com/ask` with a **Platform/Premium** login → tap **Voice** → speak ~3s → **Stop**.
- On **success** the question auto-fills and Ask answers; the UI shows **no** `VOICE-DIAG` (it appears only on failure). Capture the success fields from the engine log: Render → `securelogic-engine-staging` → Logs → filter `voice_transcribe_diagnostic` → the `outcome:"ok"` line (has `file_mimetype`, `file_size`, `correlationId`).
- On **failure** expand **"Diagnostic details"** and copy the `VOICE-DIAG …` line; note its `cid`; find the matching engine `voice_transcribe_diagnostic` log line.

---

## Browser Matrix

| Browser | Device | Mic Visible | Record Starts | Record Stops | Question Auto-Fills | Ask Answers Correctly | Result |
|----------|--------|------------|---------------|--------------|---------------------|------------------------|--------|
| iPad Safari | | | | | | | ⏳ Pending |
| Desktop Chrome | | | | | | | ⏳ Pending |
| Desktop Safari | | | | | | | ⏳ Pending |
| Edge | | | | | | | ⏳ Pending |

---

## Successful Run Evidence

For every **PASS**, capture: Correlation ID · Timestamp · File MIME · File Size · HTTP Status · Engine Outcome · Notes.

| Browser | Correlation ID | Timestamp | File MIME | File Size | HTTP Status | Engine Outcome | Notes |
|----------|----------------|-----------|-----------|-----------|-------------|----------------|-------|
| _(none yet — pending validation)_ | | | | | | | |

---

## Failure Evidence

For every **failure**, capture the `VOICE-DIAG` line, the matching engine log, the root cause, the fix, and the PR.

| Browser | VOICE-DIAG (as captured) | Root Cause | Fix | PR | Status |
|---|---|---|---|---|---|
| iPad Safari (pre-fix, diagnostic build) | `cid=6bd2eb48-1761-438d-a722-68c405e1f7f6 … sel=audio/webm rec=audio/webm; codecs=opus blob=audio/webm; codecs=opus/115417B ext=webm http=415 code=unsupported_media_type` | The device recorded a **valid 115 KB `audio/webm; codecs=opus`** file — **not** a device/capability limit. The `415` came from the global content-type enforcement guard in `src/api/app.ts`, whose exemption list **omitted `/api/ask/transcribe`**, so the multipart audio upload was rejected **at the gate** before the route ran (cause B — our implementation). Broke voice on **all** browsers, not just iPad. | Added `/api/ask/transcribe` to the content-type exemption (extracted to the tested `contentTypeAllowlist.ts` predicate) + hardened the transcribe `fileFilter` to match the base MIME. | #422 | ✅ Resolved — staging verified `415 → 401` (request now reaches auth instead of the guard) |

---

## Supported Browser Matrix

Populate **only** with browsers verified by evidence in the Browser Matrix + Successful Run Evidence above. **Do not mark a browser Supported without a captured PASS.**

| Browser | Supported | Evidence |
|----------|-----------|----------|
| Desktop Chrome | ⏳ Pending until validated | — |
| Desktop Safari | ⏳ Pending until validated | — |
| iPad Safari | ⏳ Pending until validated | — |
| Edge | ⏳ Pending until validated | — |

---

## Launch Exit Criteria

Voice is **production-ready only when**:

- [ ] Every supported browser passes the Browser Matrix
- [ ] Question auto-fills correctly
- [ ] Ask answers correctly
- [ ] Engine outcome = `ok`
- [ ] No transcription errors
- [ ] No regressions after deployment

**Current status:** ❌ **Not met** — browser matrix pending operator capture. Server pipeline proven (automated `transcribeRoute.test.ts` → `200 ok`; guard 415-regression locked; staging `415 → 401`).

---

## Regression History

Append a row for every voice-related change.

| Date | PR | Description | Result |
|------------|------|-------------|--------|
| 2026-06-30 | #418 | Temporary iPad/iOS voice gate (precautionary, pre-diagnosis) | Shipped (develop) — later superseded by #423 |
| 2026-06-30 | #420 | Voice diagnostics: correlation-id `VOICE-DIAG` (browser→app→engine) + engine `voice_transcribe_diagnostic` | Shipped (develop) |
| 2026-06-30 | #422 | **Root-cause fix:** `/api/ask/transcribe` exempted from the JSON content-type guard (was the 415) + base-MIME `fileFilter` | Shipped (develop); staging `415 → 401` |
| 2026-06-30 | #423 | Re-enable voice via **capability-only** detection (no name blacklist) + regression tests (transcribe pipeline `200 ok`; guard 415 lock; capable iPad offered voice) | Shipped (develop); full engine suite green (4714) |
