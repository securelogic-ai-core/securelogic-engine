# Stop Gate ASK-C — Voice Data Governance

Session 2, 2026-08-13. Status: **Engineering review COMPLETE for the live
push-to-talk path; realtime voice DEFERRED (P1 cut rule applied).**

## Scope reviewed

Voice today is push-to-talk, and it already satisfies the ratified
architecture's core demand — *voice uses the same Ask/tool layer*:

```
browser mic → app /api/transcribe (server-side proxy, iron-session)
           → engine POST /api/ask/transcribe (Whisper) → text
           → the ORDINARY Ask path (same tools, same authorization, same ledger)
```

There is no separate voice retrieval path, no voice-only authorization, and no
way for audio to reach a tool. The transcript enters the system exactly as a
typed question would.

## Findings

### Audio handling — PASS

- **No engine-side audio persistence.** `multer.memoryStorage()`; the buffer is
  handed to the Whisper SDK and goes out of scope. No disk write, no blob
  store, no DB column anywhere for audio.
- **Diagnostic logging never logs audio** — correlation id, MIME, sizes,
  classified outcome only (`voiceTranscribeDiagnostics`). Verified by reading
  every log call in the route.
- **Transcript persistence is the Ask path's**: text is returned to the client
  and only persisted if the user submits it as a question, where it lands in
  `ask_messages` under the existing user-scoping + GDPR treatment (categories
  set in the A1 data-classification review).

### Third-party processor — DISCLOSED, operator sign-off owed

Audio bytes are sent to **OpenAI Whisper** (`whisper-1`) under the platform's
`OPENAI_API_KEY`. This is the one place customer voice audio leaves the
platform. ASK-C's remaining human item: confirm the DPA/subprocessor listing
covers OpenAI for audio, or disable voice in production (it degrades cleanly —
`/ask/transcribe/status` reports unconfigured and the UI hides the control).

### Defect found and fixed — org rate limit was vacuous (P1)

The transcribe rate limiter keyed on `req.organizationId`, a field **nothing in
the codebase assigns** (org identity lives on `req.organizationContext`). Every
request fell through to the IP key, and behind Cloudflare's rotating edge IPs
each edge address got its own 10/min bucket — effectively no per-org limit on a
paid model call. Same fragmentation class as the adminLockout fix. Now keyed on
`organizationContext.organizationId` (the middleware chain guarantees it is set
before the limiter runs). The diagnostic log's always-null `organizationId`
field was fixed with it.

### Hardcoded `language: "en"` — recorded, not blocking

Non-English speech is transcribed badly rather than rejected. A product choice
to make explicitly later; no governance impact.

## Realtime voice — DEFERRED

The ratified cut rule ("if voice threatens the critical path, defer voice")
applies: realtime/streaming voice requires a duplex transport, a realtime
provider integration, and its own review of what a live audio stream may
trigger. Nothing in the current architecture blocks it later — conversations
already carry `mode: 'voice'`, and any future voice surface inherits the same
Ask/tool layer by construction. Deferred in favour of completing the reviewer
UI and the operator-owed staging gates.

## Gate verdict

| Criterion | Status |
|---|---|
| Voice uses the same Ask/tool layer | **PASS** (by construction, verified) |
| No audio retention outside the governed stores | **PASS** |
| No audio/PII in logs | **PASS** |
| Abuse limiting actually scoped to the tenant | **PASS** (after fix) |
| Subprocessor disclosure for audio | **Operator-owed** |
| Realtime voice governance | **N/A — deferred** |
