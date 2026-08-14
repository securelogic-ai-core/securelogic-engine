/**
 * voiceGovernance.ts — pure client-side pieces of the ASK-C voice gate (LC-4).
 *
 * Two responsibilities, both dependency-free so the repo-root vitest run can
 * prove them without a browser:
 *
 *  1. DISCLOSURE LATCH (ASK-C C-2): capture must never start before the user
 *     has seen, once, in plain language, where their audio goes. The latch is
 *     per-browser (localStorage) — a governance acknowledgment, not a
 *     preference, so it deliberately does NOT sync across devices: each new
 *     browser sees the disclosure again.
 *
 *  2. SPOKEN READBACK (LC-4 realtime loop): browser-local SpeechSynthesis.
 *     No audio leaves the device — the answer text is synthesized locally,
 *     which is what keeps the realtime loop inside the gate's existing
 *     provider surface (see ask-c-voice-gate.md, realtime scope ruling).
 */

export const VOICE_DISCLOSURE_STORAGE_KEY = "securelogic_voice_disclosure_ack_v1";

/**
 * The disclosure shown before first voice use. Reviewed language — covers the
 * three facts ASK-C C-2 requires: audio goes to OpenAI for transcription,
 * SecureLogic does not store the audio, and the transcript becomes the Ask
 * question (stored like any typed question).
 */
export const VOICE_DISCLOSURE_TEXT =
  "Voice questions are transcribed by OpenAI Whisper. Your audio is sent to " +
  "OpenAI for transcription only and is not stored by SecureLogic. The " +
  "transcribed text becomes your Ask question and is saved to your " +
  "conversation history exactly like a typed question.";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

/** True when the disclosure must be shown before capture may start. */
export function needsVoiceDisclosure(storage: StorageLike | null): boolean {
  if (!storage) return true; // no storage → always disclose; never assume consent
  try {
    return storage.getItem(VOICE_DISCLOSURE_STORAGE_KEY) !== "true";
  } catch {
    return true;
  }
}

/** Latch the acknowledgment. Failure to persist means we disclose again — the
 *  failure mode errs toward more disclosure, never less. */
export function acknowledgeVoiceDisclosure(storage: StorageLike | null): void {
  try {
    storage?.setItem(VOICE_DISCLOSURE_STORAGE_KEY, "true");
  } catch {
    // Quota/private-mode failures: the next press discloses again. Correct.
  }
}

// ─── Readback ───────────────────────────────────────────────────────────────

type SpeechSynthesisLike = {
  cancel: () => void;
  speak: (utterance: SpeechSynthesisUtterance) => void;
};

/** Read an answer aloud, replacing any in-flight readback. No-ops (returns
 *  false) when synthesis is unavailable — readback is an enhancement; the
 *  text answer is already on screen. */
export function speakAnswer(
  text: string,
  synth: SpeechSynthesisLike | null | undefined =
    typeof window !== "undefined" ? window.speechSynthesis : null
): boolean {
  if (!synth || typeof SpeechSynthesisUtterance === "undefined") return false;
  try {
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    synth.speak(utterance);
    return true;
  } catch {
    return false;
  }
}

/** Stop any in-flight readback (new question submitted, toggle turned off). */
export function stopSpeaking(
  synth: SpeechSynthesisLike | null | undefined =
    typeof window !== "undefined" ? window.speechSynthesis : null
): void {
  try {
    synth?.cancel();
  } catch {
    // Nothing to stop.
  }
}
