/**
 * askVoiceFeatureFlag.ts — the two voice flags (ASK-C C-9, Launch Completion 4).
 *
 * ASK_VOICE_ENABLED — the INDEPENDENT VOICE KILL SWITCH.
 *   Default ON; only the literal "false" disables. Voice (push-to-talk →
 *   Whisper → Ask) is live in production, so defaulting off would silently
 *   remove shipped behavior on deploy — the same reasoning as
 *   SECURELOGIC_ASK_ENABLED. Killing voice never touches text Ask; killing
 *   Ask (askFeatureFlag, mounted first on the transcribe chain) kills voice
 *   with it — voice exists only to feed Ask, so the implication is one-way
 *   by design.
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
  return env["SECURELOGIC_ASK_VOICE_ENABLED"] !== "false";
}

export function askVoiceRealtimeEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env["SECURELOGIC_ASK_VOICE_REALTIME_ENABLED"] === "true";
}
