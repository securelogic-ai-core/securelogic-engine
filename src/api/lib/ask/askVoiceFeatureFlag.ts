/**
 * askVoiceFeatureFlag.ts — the two voice flags (ASK-C C-9, Launch Completion 4).
 *
 * ASK_VOICE_ENABLED — the INDEPENDENT VOICE KILL SWITCH.
 *   Default OFF; only the literal "true" enables. Killing voice never touches
 *   text Ask; killing Ask (askFeatureFlag, mounted first on the transcribe
 *   chain) kills voice with it — voice exists only to feed Ask, so the
 *   implication is one-way by design.
 *
 *   THIS DEFAULT WAS INVERTED ON 2026-08-28 (SEC-VOICE-1 / gate C-6).
 *
 *   It previously read `!== "false"` — fail-OPEN — on the stated reasoning
 *   that "voice is live in production, so defaulting off would silently
 *   remove shipped behavior on deploy". That reasoning holds for an ordinary
 *   feature. It does not hold for this one, because this flag is the boundary
 *   that decides whether customer audio leaves our infrastructure for a THIRD
 *   PARTY (OpenAI Whisper). A subprocessor boundary that is open unless
 *   someone remembers to close it is not a boundary.
 *
 *   The empirical consequence, verified in production on 2026-08-28: nobody
 *   ever turned voice on in production. The key was simply never set, the
 *   default did the rest, and `POST /api/ask/transcribe` answered 401 rather
 *   than 404 — proof the request had passed this gate — while the ASK-C C-6
 *   subprocessor/DPA sign-off remained unrecorded.
 *
 *   Opt-in restores the intended property: transmission to the subprocessor
 *   requires a deliberate, auditable act. After C-6 is approved, set
 *   SECURELOGIC_ASK_VOICE_ENABLED=true to reactivate deliberately. The
 *   capability itself is untouched — this changes who has to say yes.
 *
 * ASK_VOICE_REALTIME_ENABLED — DARK LAUNCH of the LC-4 realtime loop
 *   (spoken readback of streamed answers via browser-local SpeechSynthesis).
 *   Default OFF; only the literal "true" enables — new customer-facing
 *   behavior no staging environment has exercised. Note the loop adds NO new
 *   audio recipient: readback is synthesized on the user's device. Duplex
 *   provider streaming remains decision-gated outside this flag entirely
 *   (see ask-c-voice-gate.md, realtime scope ruling).
 */

export function askVoiceEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["SECURELOGIC_ASK_VOICE_ENABLED"] === "true";
}

export function askVoiceRealtimeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["SECURELOGIC_ASK_VOICE_REALTIME_ENABLED"] === "true";
}
