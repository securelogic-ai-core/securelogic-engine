"use client";

import { useState, useRef, useCallback, useEffect, useTransition } from "react";
import {
  askAction,
  listConversationsAction,
  getConversationAction,
  resolveProposalAction,
} from "./actions";
import { describeProposalOutcome, proposalExpired, type ProposalOutcome } from "./askProposals";
import type { AskProposedAction } from "@/lib/api";
import { streamAsk } from "./askStream";
import {
  needsVoiceDisclosure,
  acknowledgeVoiceDisclosure,
  VOICE_DISCLOSURE_TEXT,
  speakAnswer,
  stopSpeaking,
} from "./voiceGovernance";
import {
  detectVoiceSupport,
  readVoiceEnv,
  VOICE_UNSUPPORTED_MESSAGE,
  type VoiceSupport,
} from "./voiceSupport";
import {
  VOICE_DIAGNOSTIC_HEADER,
  buildDiagnosticCode,
  emptyDiagnostic,
  newCorrelationId,
  type VoiceDiagnostic,
} from "./voiceDiagnostics";
import type {
  AskResponse,
  AskClaim,
  AskContextUsed,
  AskConversationSummary,
} from "@/lib/api";

// ─────────────────────────────────────────────────────────────
// Error message tables
//
// The engine surfaces structured error codes (rate_limit_exceeded,
// ask_unavailable, ask_failed, etc.); we map them to human-friendly
// strings here. Unmapped codes fall back to a generic message but the
// raw code + message are also console.error'd so support can recover
// the actual failure without asking the user to repro.
// ─────────────────────────────────────────────────────────────

type StructuredError = {
  status: number;
  code?: string;
  message?: string;
};

const ASK_ERROR_MESSAGES: Record<string, string> = {
  ask_unavailable:    "Ask is temporarily unavailable. Please try again in a moment.",
  ask_failed:         "Something went wrong processing your question. Please try again.",
  unauthorized:       "Your session has expired. Please sign in again.",
  rate_limit_exceeded:"Too many questions. Please wait a moment and try again.",
  rate_limited:       "Too many questions. Please wait a moment and try again.",
  network_error:      "Couldn't reach the server. Check your connection and try again.",
  question_required:  "Please enter a question before submitting.",
  question_too_long:  "Your question is too long. Please shorten it to 500 characters or fewer.",
  parse_error:        "The server returned an unexpected response. Please try again.",
  conversation_not_found: "That conversation is no longer available.",
};

const TRANSCRIBE_ERROR_MESSAGES: Record<string, string> = {
  voice_disabled_for_org:    "Voice input is disabled for your organization. Please type your question instead.",
  not_found:                 "Voice input is currently unavailable. Please type your question instead.",
  transcription_unavailable: "Voice transcription is not configured on this server. Please type your question instead.",
  transcription_failed:      "Couldn't transcribe your audio. Please try again or type your question.",
  no_audio:                  "No audio was captured. Please try recording again.",
  unsupported_audio_type:    "This audio format isn't supported. Please try a different browser.",
  unauthorized:              "Your session has expired. Please sign in again.",
  rate_limit_exceeded:       "Too many transcription attempts. Please wait a moment and try again.",
  network_error:             "Couldn't reach the server. Check your connection and try again.",
};

const ASK_FALLBACK = "Unable to process your question. Please try again.";
const TRANSCRIBE_FALLBACK = "Could not transcribe audio. Please try again.";

// ─────────────────────────────────────────────────────────────
// Example chips
// ─────────────────────────────────────────────────────────────

const EXAMPLE_QUESTIONS = [
  "What are my top 3 vendors by risk exposure?",
  "Show me my critical active findings",
  "What's my overall security posture?",
  "Which risks need immediate attention?",
  "How many overdue actions do I have?",
  "What domains have the most risk?",
];

// ─────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────

const CARD: React.CSSProperties = {
  background: "#0d1626",
  border: "1px solid #1e2d45",
  borderRadius: "12px",
};

// ─────────────────────────────────────────────────────────────
// Metadata helpers
// ─────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return "unknown date";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

/** Compact relative timestamp for the thread list ("just now", "5m", "3h", "2d", else a date). */
function formatRelative(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const deltaMs = Date.now() - then;
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(iso);
}

/**
 * The "answered from" caption under an answer. The engine returns two
 * context_used shapes (snapshot vs tool retrieval — see AskContextUsed in
 * lib/api.ts); render whichever one actually arrived, never assume fields.
 */
function contextCaption(ctx: AskContextUsed | undefined): string | null {
  if (!ctx) return null;
  if (ctx.retrieval === "tools") {
    const calls = ctx.tool_calls ?? 0;
    const denied = ctx.tools_denied ?? 0;
    const parts = [`${calls} authorized data read${calls === 1 ? "" : "s"}`];
    if (denied > 0) parts.push(`${denied} denied`);
    if (ctx.complete === false) parts.push("partial");
    return parts.join(" · ");
  }
  if (
    ctx.posture_score === undefined &&
    ctx.findings_count === undefined &&
    ctx.risks_count === undefined
  ) {
    return null;
  }
  const bits: string[] = [];
  bits.push(
    ctx.posture_score != null ? `Posture score ${ctx.posture_score}` : "No posture snapshot"
  );
  if (ctx.findings_count !== undefined) bits.push(`${ctx.findings_count} active findings`);
  if (ctx.risks_count !== undefined) bits.push(`${ctx.risks_count} risks`);
  if (ctx.as_of) bits.push(`as of ${formatDate(ctx.as_of)}`);
  return bits.join(" · ");
}

// ─────────────────────────────────────────────────────────────
// Claims / provenance rendering
//
// Assistant turns loaded from a stored thread carry `claims` — the
// verified-claims structure captured at answer time (engine
// conversationStore.AskMessage). Live answers carry the same family under
// `provenance.claims`. Citations are RENDERED from these records, never
// recomputed. Both citation spellings the engine emits are handled
// (`tool_name` in the stored shape, `tool` in the POST response shape).
// ─────────────────────────────────────────────────────────────

/** Defensive parse of the stored jsonb claims column into renderable claims. */
function normalizeClaims(raw: unknown): AskClaim[] | null {
  // The column may hold the raw Claim[] or a wrapped { claims: Claim[] }
  // (VerifiedClaims). Anything else — null, junk — renders no provenance.
  const arr: unknown = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { claims?: unknown }).claims)
      ? (raw as { claims: unknown[] }).claims
      : null;
  if (!Array.isArray(arr)) return null;
  const claims: AskClaim[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const c = item as Record<string, unknown>;
    if (typeof c.text !== "string" || typeof c.claim_class !== "string") continue;
    claims.push({
      text: c.text,
      claim_class: c.claim_class,
      citations: Array.isArray(c.citations)
        ? (c.citations.filter((x) => x && typeof x === "object") as AskClaim["citations"])
        : [],
      ...(Array.isArray(c.derived_from)
        ? { derived_from: c.derived_from.filter((n): n is number => typeof n === "number") }
        : {}),
    });
  }
  return claims.length > 0 ? claims : null;
}

/** Class badge palette — observed is the strongest evidence, inference the model's own reasoning. */
function claimClassStyle(cls: string): { color: string; border: string } {
  switch (cls) {
    case "observed":       return { color: "#00c4b4", border: "rgba(0,196,180,0.4)" };
    case "derived":        return { color: "#60a5fa", border: "rgba(96,165,250,0.4)" };
    case "inference":      return { color: "#fbbf24", border: "rgba(251,191,36,0.4)" };
    case "recommendation": return { color: "#c084fc", border: "rgba(192,132,252,0.4)" };
    default:               return { color: "#94a3b8", border: "#1e2d45" };
  }
}

/** One citation's "what this was verified against" line. */
function citationLabel(cit: AskClaim["citations"][number]): string {
  const parts: string[] = [];
  const tool = cit.tool_name ?? cit.tool;
  if (tool) parts.push(tool);
  if (cit.object_type) parts.push(cit.object_type);
  if (cit.object_id) parts.push(String(cit.object_id).slice(0, 8));
  if (cit.field) parts.push(cit.field);
  return parts.join(" · ");
}

function ClaimsDetails({ claims }: { claims: AskClaim[] }) {
  return (
    <details style={{ marginTop: "14px" }}>
      <summary
        style={{
          cursor: "pointer",
          fontSize: "11px",
          fontWeight: 600,
          color: "#94a3b8",
          userSelect: "none",
        }}
      >
        Provenance · {claims.length} claim{claims.length === 1 ? "" : "s"}
      </summary>
      <ul style={{ margin: "10px 0 0", padding: 0, listStyle: "none" }}>
        {claims.map((claim, i) => {
          const style = claimClassStyle(claim.claim_class);
          return (
            <li
              key={i}
              style={{
                padding: "8px 10px",
                marginBottom: "6px",
                background: "#0a0f1a",
                border: "1px solid #1e2d45",
                borderRadius: "6px",
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  padding: "1px 8px",
                  borderRadius: "999px",
                  border: `1px solid ${style.border}`,
                  color: style.color,
                  fontSize: "10px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.4px",
                  marginBottom: "4px",
                }}
              >
                {claim.claim_class}
              </span>
              <p style={{ margin: "4px 0 0", fontSize: "12px", lineHeight: 1.5, color: "#cbd5e1" }}>
                {claim.text}
              </p>
              {claim.citations.length > 0 && (
                <p style={{ margin: "4px 0 0", fontSize: "11px", color: "#64748b" }}>
                  {claim.claim_class === "inference" ? "Reasoned from" : "Verified against"}:{" "}
                  {claim.citations.map(citationLabel).filter(Boolean).join("; ")}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

// ─────────────────────────────────────────────────────────────
// Transcript model
// ─────────────────────────────────────────────────────────────

type TranscriptTurn = {
  key: string;
  role: "user" | "assistant";
  content: string;
  claims: AskClaim[] | null;
  contextUsed?: AskContextUsed;
};

// ─────────────────────────────────────────────────────────────
// Mic SVG
// ─────────────────────────────────────────────────────────────

const OUTCOME_COLORS: Record<ProposalOutcome["tone"], string> = {
  success: "#00c4b4",
  warning: "#f59e0b",
  muted: "#64748b",
  error: "#f87171",
};

/**
 * Proposed-mutation cards (ASK-B). The summary shown is the SERVER-rendered
 * change-set — what the user confirms is what the engine froze, not what the
 * model narrated. Confirm and Discard both spend the single-use token; every
 * outcome is terminal and replaces the buttons.
 */
function ProposalCards({
  proposals,
  outcomes,
  onResolve,
}: {
  proposals: AskProposedAction[];
  outcomes: Record<string, { working: boolean; outcome: ProposalOutcome | null }>;
  onResolve: (proposal: AskProposedAction, decision: "confirm" | "decline") => void;
}) {
  if (proposals.length === 0) return null;
  return (
    <div>
      {proposals.map((p) => {
        const state = outcomes[p.id];
        const outcome = state?.outcome ?? null;
        const expired = !outcome && proposalExpired(p.expires_at);
        return (
          <div
            key={p.id}
            style={{
              ...CARD,
              padding: "16px 20px",
              marginBottom: "12px",
              borderColor: "rgba(245,158,11,0.4)",
            }}
          >
            <span
              style={{
                display: "block",
                fontSize: "10px",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                color: "#f59e0b",
                marginBottom: "6px",
              }}
            >
              Proposed change — needs your confirmation
            </span>
            <p
              style={{
                margin: "0 0 12px",
                fontSize: "14px",
                lineHeight: "1.7",
                color: "#e2e8f0",
              }}
            >
              {p.summary}
            </p>
            {outcome ? (
              <p style={{ margin: 0, fontSize: "13px", color: OUTCOME_COLORS[outcome.tone] }}>
                {outcome.text}
              </p>
            ) : expired ? (
              <p style={{ margin: 0, fontSize: "13px", color: OUTCOME_COLORS.muted }}>
                Expired — ask again for a fresh proposal.
              </p>
            ) : (
              <div style={{ display: "flex", gap: "10px" }}>
                <button
                  onClick={() => onResolve(p, "confirm")}
                  disabled={state?.working === true}
                  style={{
                    padding: "8px 18px",
                    borderRadius: "8px",
                    border: "none",
                    background: "#f59e0b",
                    color: "#0a0f1a",
                    fontSize: "13px",
                    fontWeight: 700,
                    cursor: state?.working ? "wait" : "pointer",
                    opacity: state?.working ? 0.6 : 1,
                  }}
                >
                  {state?.working ? "Applying…" : "Confirm and apply"}
                </button>
                <button
                  onClick={() => onResolve(p, "decline")}
                  disabled={state?.working === true}
                  style={{
                    padding: "8px 18px",
                    borderRadius: "8px",
                    border: "1px solid #1e2d45",
                    background: "transparent",
                    color: "#94a3b8",
                    fontSize: "13px",
                    cursor: state?.working ? "wait" : "pointer",
                  }}
                >
                  Discard
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function MicIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────

export function AskClient({
  streamingEnabled = false,
  voiceEnabled = true,
  readbackEnabled = false,
}: {
  /** Server-rendered from SECURELOGIC_ASK_STREAMING_ENABLED (two-switch model).
   *  Off = this component is byte-for-byte the pre-LC-3 behaviour. */
  streamingEnabled?: boolean;
  /** ASK-C (LC-4): voice kill switch AND the tenant's voice_input_enabled,
   *  collapsed server-side. False hides the mic; the engine enforces
   *  independently (403 voice_disabled_for_org / 404 kill switch). */
  voiceEnabled?: boolean;
  /** LC-4 realtime loop: offer browser-local spoken readback of answers to
   *  voice questions. Dark by default (SECURELOGIC_ASK_VOICE_REALTIME_ENABLED). */
  readbackEnabled?: boolean;
} = {}) {
  const [query, setQuery]           = useState("");
  const [answer, setAnswer]         = useState<AskResponse | null>(null);
  const [error, setError]           = useState<StructuredError | null>(null);
  const [isPending, startTransition] = useTransition();
  const textareaRef                 = useRef<HTMLTextAreaElement | null>(null);

  // ── Streaming preview state (LC-3) ──
  //
  // `streamText` is the delta accumulation for the CURRENT model round; it is
  // preview only and is always replaced by the `final` payload (the provenance
  // pass may re-render prose after the last delta). `streamTools` is the
  // retrieval activity line. `streamUnsupportedRef` latches when the endpoint
  // turns out to be dark so we only pay the probe once per page load.
  const [streamText, setStreamText]   = useState<string | null>(null);
  const [streamTools, setStreamTools] = useState<Array<{ tool: string; authorized: boolean }>>([]);
  const streamUnsupportedRef = useRef(false);

  // ── Multi-turn state (Ask A3) ──
  //
  // The sidebar renders only once we have EVIDENCE threads exist: a non-empty
  // list read, or an ask response that returned a conversation_id. On engines
  // where the tool path is dark (no conversation_id, empty/absent conversation
  // reads) none of this state ever activates and the page behaves exactly like
  // single-shot Ask — no dead sidebar, no errors.
  const [conversations, setConversations] = useState<AskConversationSummary[]>([]);
  const [threadsAvailable, setThreadsAvailable] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptTurn[] | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);

  const [isRecording, setIsRecording]     = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingError, setRecordingError] = useState<StructuredError | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef   = useRef<Blob[]>([]);

  // ── Voice governance (ASK-C, LC-4) ──
  //
  // The disclosure card gates the FIRST capture: the mic press renders it
  // instead of recording until the user explicitly continues (latched per
  // browser — see voiceGovernance.ts). `voiceOriginRef` marks the next submit
  // as voice-originated so readback knows to speak the answer; it is consumed
  // (reset) by submitQuery.
  const [showVoiceDisclosure, setShowVoiceDisclosure] = useState(false);
  const [speakAnswers, setSpeakAnswers] = useState(false);
  const voiceOriginRef = useRef(false);

  // ── Proposed mutations (ASK-B, LC-5) ──
  //
  // The LIVE turn's proposals only. The raw token lives inside these objects
  // in memory and nowhere else; a new question clears them (the server-side
  // TTL retires the rows regardless of what the client shows).
  const [proposals, setProposals] = useState<AskProposedAction[]>([]);
  const [proposalOutcomes, setProposalOutcomes] = useState<
    Record<string, { working: boolean; outcome: ProposalOutcome | null }>
  >({});

  // Voice capability detection (capability only — no browser/device name
  // gating). Starts null so the server render and the first client render agree
  // (no hydration mismatch); the real decision is made in a mount effect once
  // `navigator`/`MediaRecorder` are available. While null, neither the mic
  // button nor the unsupported note renders. The mic shows whenever the browser
  // is genuinely capable (incl. iPad/iPhone); it hides only on a real
  // capability gap. See voiceSupport.ts.
  const [voiceSupport, setVoiceSupport] = useState<VoiceSupport | null>(null);
  // Last voice diagnostic (non-sensitive) to surface on failure.
  const [diagnostic, setDiagnostic] = useState<VoiceDiagnostic | null>(null);
  useEffect(() => {
    setVoiceSupport(detectVoiceSupport(readVoiceEnv()));
  }, []);

  // Load the caller's threads once on mount. Null (engine without the routes,
  // auth failure, network) and [] both mean: stay single-shot, silently.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await listConversationsAction();
      if (cancelled || !result) return;
      if (result.conversations.length > 0) {
        setConversations(result.conversations);
        setThreadsAvailable(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [query]);

  /** Best-effort list refresh after a turn lands — ordering/titles are the engine's. */
  const refreshConversations = useCallback(async () => {
    const result = await listConversationsAction();
    if (result && result.conversations.length > 0) {
      setConversations(result.conversations);
      setThreadsAvailable(true);
    }
  }, []);

  /** Success handling shared by the streaming and non-streaming paths, so the
   *  two cannot drift: the `final` SSE payload and the JSON body are the same
   *  shape and land in exactly this code. */
  const applyAskSuccess = useCallback(
    (q: string, data: AskResponse) => {
      // Proposals belong to THIS answer; outcomes start clean.
      setProposals(data.proposed_actions ?? []);
      setProposalOutcomes({});
      if (data.conversation_id) {
        // Multi-turn: append both turns to the transcript and adopt the
        // thread. Citations for the live turn come from the provenance
        // captured with this answer.
        const stamp = Date.now();
        setTranscript((prev) => [
          ...(prev ?? []),
          { key: `u-${stamp}`, role: "user", content: q, claims: null },
          {
            key: `a-${stamp}`,
            role: "assistant",
            content: data.answer,
            claims: data.provenance ? normalizeClaims(data.provenance.claims) : null,
            contextUsed: data.context_used,
          },
        ]);
        setSelectedId(data.conversation_id);
        setThreadsAvailable(true);
        setQuery("");
        void refreshConversations();
      } else {
        // No conversation_id — the engine ran single-shot. Behave exactly
        // like today's Ask.
        setAnswer(data);
      }
    },
    [refreshConversations]
  );

  const applyAskFailure = useCallback(
    (failure: { status: number; code?: string; message?: string }) => {
      // Surface the raw failure to the browser console so support can
      // pull it without asking the user to repro. The user-facing
      // message is mapped from the code in the JSX render below.
      // eslint-disable-next-line no-console
      console.error("Ask request failed:", {
        status: failure.status,
        code:   failure.code,
        message:failure.message,
      });
      setError({ status: failure.status, code: failure.code, message: failure.message });
    },
    []
  );

  /** Spend a proposal's single-use token. The outcome line replaces the
   *  buttons — executed, refused, and declined are all terminal states. */
  const resolveProposal = useCallback(
    async (proposal: AskProposedAction, decision: "confirm" | "decline") => {
      setProposalOutcomes((prev) => ({
        ...prev,
        [proposal.id]: { working: true, outcome: null },
      }));
      const result = await resolveProposalAction(proposal.token, decision);
      setProposalOutcomes((prev) => ({
        ...prev,
        [proposal.id]: { working: false, outcome: describeProposalOutcome(result) },
      }));
    },
    []
  );

  const submitQuery = useCallback(
    (text: string) => {
      const q = text.trim();
      if (!q || isPending) return;
      // Voice-origin marker is consumed exactly once per submit; a new
      // question always silences any in-flight readback first.
      const fromVoice = voiceOriginRef.current;
      voiceOriginRef.current = false;
      stopSpeaking();
      // A new question supersedes any unresolved proposal cards; the rows
      // expire server-side, so clearing here loses nothing executable.
      setProposals([]);
      setProposalOutcomes({});
      const maybeSpeak = (answerText: string) => {
        if (fromVoice && readbackEnabled && speakAnswers) speakAnswer(answerText);
      };
      setError(null);
      setAnswer(null);
      setPendingQuestion(q);
      // Continue the SELECTED thread; with no selection the engine starts a
      // new one and we adopt the id it returns.
      const conversationId = selectedId;
      startTransition(async () => {
        // ── Streaming path (LC-3) ──
        // Enabled at render time from the server env; falls back to the
        // action permanently for this page load if the endpoint is dark.
        if (streamingEnabled && !streamUnsupportedRef.current) {
          const outcome = await streamAsk(q, conversationId, {
            onRound: () => {
              setStreamText("");
              setStreamTools([]);
            },
            onDelta: (t) => setStreamText((prev) => (prev ?? "") + t),
            onToolCall: (tool, authorized) =>
              setStreamTools((prev) => [...prev, { tool, authorized }]),
          });
          setStreamText(null);
          setStreamTools([]);
          if (outcome.kind === "final") {
            setPendingQuestion(null);
            applyAskSuccess(q, outcome.data);
            maybeSpeak(outcome.data.answer);
            return;
          }
          if (outcome.kind === "error") {
            setPendingQuestion(null);
            applyAskFailure(outcome);
            return;
          }
          // fallback: remember, and continue into the non-streaming path.
          streamUnsupportedRef.current = true;
        }

        const result = await askAction(q, conversationId);
        setPendingQuestion(null);
        if (result.ok) {
          applyAskSuccess(q, result.data);
          maybeSpeak(result.data.answer);
        } else {
          applyAskFailure(result);
        }
      });
    },
    [
      isPending,
      selectedId,
      streamingEnabled,
      readbackEnabled,
      speakAnswers,
      applyAskSuccess,
      applyAskFailure,
    ]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        submitQuery(query);
      }
    },
    [query, submitQuery]
  );

  const reset = useCallback(() => {
    setAnswer(null);
    setError(null);
    setQuery("");
    setProposals([]);
    setProposalOutcomes({});
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, []);

  /** Start a fresh thread: clear selection + transcript, back to the blank composer. */
  const startNewConversation = useCallback(() => {
    setSelectedId(null);
    setTranscript(null);
    setAnswer(null);
    setError(null);
    setQuery("");
    setProposals([]);
    setProposalOutcomes({});
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, []);

  /** Load a thread's transcript. Claims render from the STORED structure. */
  const selectThread = useCallback(
    (id: string) => {
      if (threadLoading || isPending) return;
      setThreadLoading(true);
      setError(null);
      setAnswer(null);
      startTransition(async () => {
        const detail = await getConversationAction(id);
        setThreadLoading(false);
        if (!detail) {
          // Not-found and not-owned are indistinguishable by contract. Drop
          // the stale row and say so plainly.
          setConversations((prev) => prev.filter((c) => c.id !== id));
          setError({ status: 404, code: "conversation_not_found" });
          return;
        }
        setSelectedId(detail.conversation.id);
        setTranscript(
          detail.messages.map((m) => ({
            key: m.id,
            role: m.role,
            content: m.content,
            claims: m.role === "assistant" ? normalizeClaims(m.claims) : null,
          }))
        );
      });
    },
    [threadLoading, isPending]
  );

  const toggleRecording = useCallback(async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      return;
    }

    // ASK-C C-2: the FIRST capture is gated on the disclosure — the press
    // renders the card instead of recording until the user continues. The
    // latch is per-browser; getUserMedia's permission prompt remains the
    // second, OS-level consent after it.
    if (needsVoiceDisclosure(typeof window !== "undefined" ? window.localStorage : null)) {
      setShowVoiceDisclosure(true);
      return;
    }

    setRecordingError(null);
    setDiagnostic(null);

    // Build a non-sensitive diagnostic across the whole attempt so one failure
    // (especially on iPad) yields an unambiguous cause. Never holds audio.
    const diag: VoiceDiagnostic = emptyDiagnostic(newCorrelationId());
    diag.capability = voiceSupport
      ? voiceSupport.supported
        ? "supported"
        : `unsupported:${voiceSupport.reason}`
      : "unknown";

    // Record a failure: stamp the diagnostic, log it, and surface both the
    // friendly error and the diagnostic code.
    const fail = (
      stage: VoiceDiagnostic["stage"],
      code: string,
      message?: string,
      status = 0
    ) => {
      diag.stage = stage;
      diag.errorCode = code;
      diag.errorMessage = message ?? null;
      diag.uploadStatus = status || diag.uploadStatus;
      // eslint-disable-next-line no-console
      console.error("Voice diagnostic:", { ...diag }, buildDiagnosticCode(diag));
      setDiagnostic({ ...diag });
      setRecordingError({ status, code, message });
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const mimeType = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/mp4")
        ? "audio/mp4"
        : "";
      diag.selectedMimeType = mimeType;

      const mediaRecorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setIsRecording(false);
        setIsTranscribing(true);

        const recordedMime = mediaRecorder.mimeType || mimeType || "audio/webm";
        const audioBlob = new Blob(audioChunksRef.current, { type: recordedMime });
        const ext = recordedMime.includes("webm") ? "webm" : recordedMime.includes("ogg") ? "ogg" : "mp4";

        diag.recorderMimeType = mediaRecorder.mimeType || "";
        diag.blobType = audioBlob.type || "";
        diag.blobSize = audioBlob.size;
        diag.filenameExt = ext;

        try {
          // Empty/short capture (cause C) — identify client-side without
          // spending a Whisper call on zero bytes.
          if (audioBlob.size === 0) {
            fail("capture", "no_audio", "No audio was captured. Please try recording again.");
            return;
          }

          const fd = new FormData();
          fd.append("audio", audioBlob, `recording.${ext}`);
          let transcribeRes: Response;
          try {
            transcribeRes = await fetch("/api/transcribe", {
              method: "POST",
              body: fd,
              headers: { [VOICE_DIAGNOSTIC_HEADER]: diag.correlationId },
            });
          } catch (fetchErr) {
            // eslint-disable-next-line no-console
            console.error("Transcribe request failed (network):", fetchErr);
            fail("upload", "network_error");
            return;
          }

          diag.uploadStatus = transcribeRes.status;

          if (!transcribeRes.ok) {
            let body: { error?: string; message?: string } = {};
            try {
              body = (await transcribeRes.json()) as { error?: string; message?: string };
            } catch {
              // proxy returned non-JSON; surface the status with no code
            }
            fail("transcribe", body.error ?? "transcription_failed", body.message, transcribeRes.status);
            return;
          }

          const result = (await transcribeRes.json()) as { text: string };
          if (result.text) {
            diag.stage = "ok";
            setQuery(result.text);
            // Mark the submit voice-originated so readback (when enabled and
            // toggled on) speaks the answer of THIS question only.
            voiceOriginRef.current = true;
            submitQuery(result.text);
          } else {
            // 200 but empty text — shouldn't happen but guard anyway.
            fail("empty_result", "transcription_failed", undefined, 200);
          }
        } finally {
          setIsTranscribing(false);
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      const name = (err as { name?: string }).name ?? "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        fail(
          "permission",
          "microphone_denied",
          "Microphone access denied. Please allow microphone access and try again."
        );
      } else {
        // No MediaRecorder/getUserMedia, or the constructor threw (cause A).
        fail(
          "capability",
          "voice_unsupported",
          "Voice input is not supported on this browser. Please type your question instead."
        );
      }
    }
  }, [isRecording, submitQuery, voiceSupport]);

  const inTranscriptMode = transcript !== null && transcript.length > 0;

  // ── Composer (shared between single-shot and transcript layouts) ──
  const composer = (
    <div style={{ ...CARD, padding: "20px", marginBottom: "24px" }}>
      <textarea
        ref={(el) => { textareaRef.current = el; }}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={3}
        placeholder={
          inTranscriptMode
            ? "Ask a follow-up question..."
            : "Ask a question about your risk posture..."
        }
        disabled={isPending}
        style={{
          width: "100%",
          background: "transparent",
          border: "none",
          outline: "none",
          color: "#f1f5f9",
          fontSize: "15px",
          lineHeight: "1.6",
          resize: "none",
          fontFamily: "inherit",
          minHeight: "72px",
          overflow: "hidden",
        }}
      />
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: "16px",
          paddingTop: "16px",
          borderTop: "1px solid #1e2d45",
        }}
      >
        <span style={{ fontSize: "11px", color: "#334155" }}>
          {typeof navigator !== "undefined" && /Mac/.test(navigator.platform)
            ? "⌘ + Enter to submit"
            : "Ctrl + Enter to submit"}
        </span>

        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          {/* ── Microphone button ──
               Rendered whenever the browser is genuinely capable of voice
               input (capability detection only — incl. iPad/iPhone). Hidden
               only on a real capability gap, where the note below explains. */}
          {voiceEnabled && voiceSupport?.supported && (
          <button
            onClick={toggleRecording}
            disabled={isTranscribing || isPending}
            style={{
              padding: "10px 16px",
              borderRadius: "8px",
              border: isRecording ? "2px solid #ef4444" : "2px solid #00c4b4",
              background: isRecording ? "rgba(239,68,68,0.1)" : "transparent",
              color: isRecording ? "#ef4444" : "#00c4b4",
              cursor: isTranscribing || isPending ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "14px",
              transition: "all 0.2s",
              opacity: isTranscribing || isPending ? 0.5 : 1,
            }}
            aria-label={isRecording ? "Stop recording" : "Start voice input"}
          >
            {isTranscribing ? (
              <>
                <span
                  style={{
                    width: "14px",
                    height: "14px",
                    borderRadius: "50%",
                    border: "2px solid #00c4b4",
                    borderTopColor: "transparent",
                    display: "inline-block",
                    animation: "spin 0.8s linear infinite",
                  }}
                />
                Transcribing…
              </>
            ) : isRecording ? (
              <>
                <span
                  style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    background: "#ef4444",
                    display: "inline-block",
                    animation: "pulse 1s infinite",
                  }}
                />
                Stop
              </>
            ) : (
              <>
                <MicIcon />
                Voice
              </>
            )}
          </button>
          )}

          {/* ── Spoken readback toggle (LC-4 realtime loop, dark-flagged) ──
               Browser-local SpeechSynthesis — no audio leaves the device.
               Applies to answers of VOICE questions only. */}
          {readbackEnabled && voiceEnabled && voiceSupport?.supported && (
            <button
              onClick={() => {
                setSpeakAnswers((prev) => {
                  if (prev) stopSpeaking();
                  return !prev;
                });
              }}
              style={{
                padding: "10px 12px",
                borderRadius: "8px",
                border: speakAnswers ? "2px solid #00c4b4" : "2px solid #1e2d45",
                background: speakAnswers ? "rgba(0,196,180,0.1)" : "transparent",
                color: speakAnswers ? "#00c4b4" : "#64748b",
                cursor: "pointer",
                fontSize: "13px",
                transition: "all 0.2s",
              }}
              aria-pressed={speakAnswers}
              aria-label={
                speakAnswers ? "Turn off spoken answers" : "Speak answers to voice questions"
              }
              title={speakAnswers ? "Spoken answers on" : "Speak answers to voice questions"}
            >
              {speakAnswers ? "🔊" : "🔈"}
            </button>
          )}

          {/* ── Ask button ── */}
          <button
            onClick={() => submitQuery(query)}
            disabled={isPending || query.trim().length === 0}
            style={{
              padding: "10px 24px",
              borderRadius: "8px",
              border: "none",
              background: isPending || query.trim().length === 0 ? "#1e2d45" : "#00c4b4",
              color: isPending || query.trim().length === 0 ? "#475569" : "#0a0f1a",
              fontSize: "14px",
              fontWeight: 700,
              cursor: isPending || query.trim().length === 0 ? "not-allowed" : "pointer",
              transition: "background 0.15s",
            }}
          >
            {isPending ? "Analyzing…" : "Ask SecureLogic"}
          </button>
        </div>
      </div>

      {/* ── Voice disclosure (ASK-C C-2) ──
           Rendered by the first mic press; capture cannot start until the
           user explicitly continues. Latched per browser thereafter. */}
      {showVoiceDisclosure && (
        <div
          style={{
            ...CARD,
            padding: "16px 20px",
            marginTop: "12px",
            borderColor: "rgba(0,196,180,0.35)",
          }}
        >
          <p style={{ margin: "0 0 12px", fontSize: "13px", lineHeight: "1.7", color: "#e2e8f0" }}>
            {VOICE_DISCLOSURE_TEXT}
          </p>
          <div style={{ display: "flex", gap: "10px" }}>
            <button
              onClick={() => {
                acknowledgeVoiceDisclosure(
                  typeof window !== "undefined" ? window.localStorage : null
                );
                setShowVoiceDisclosure(false);
                void toggleRecording();
              }}
              style={{
                padding: "8px 18px",
                borderRadius: "8px",
                border: "none",
                background: "#00c4b4",
                color: "#0a0f1a",
                fontSize: "13px",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              Continue and record
            </button>
            <button
              onClick={() => setShowVoiceDisclosure(false)}
              style={{
                padding: "8px 18px",
                borderRadius: "8px",
                border: "1px solid #1e2d45",
                background: "transparent",
                color: "#94a3b8",
                fontSize: "13px",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Voice-disabled note (tenant governance / kill switch) ──
           Governance state beats capability messaging: when voice is off for
           this org, say so instead of the unsupported-browser note. */}
      {!voiceEnabled && (
        <p style={{ margin: "12px 0 0", fontSize: "12px", color: "#64748b" }}>
          Voice input is turned off for your organization.
        </p>
      )}

      {/* ── Voice-unsupported note ──
           Shown in place of the mic button only when capability detection
           genuinely fails (no getUserMedia/MediaRecorder/supported format),
           so users understand why voice is absent instead of seeing a
           silently broken button. */}
      {voiceEnabled && voiceSupport && !voiceSupport.supported && (
        <p
          style={{
            margin: "12px 0 0",
            fontSize: "12px",
            color: "#64748b",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <span aria-hidden="true" style={{ opacity: 0.7 }}>
            <MicIcon />
          </span>
          {VOICE_UNSUPPORTED_MESSAGE}
        </p>
      )}
    </div>
  );

  return (
    <div
      style={{
        maxWidth: threadsAvailable ? "1040px" : "720px",
        margin: "0 auto",
        padding: "48px 24px",
      }}
    >
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.3); }
        }
      `}</style>

      {/* ── Header ── */}
      <h1
        style={{
          fontSize: "28px",
          fontWeight: 800,
          color: "#f1f5f9",
          margin: "0 0 8px",
          letterSpacing: "-0.5px",
        }}
      >
        Ask SecureLogic
      </h1>
      <p style={{ margin: "0 0 32px", fontSize: "15px", color: "#64748b" }}>
        Ask anything about your risk posture in plain English
      </p>

      <div style={{ display: "flex", gap: "24px", alignItems: "flex-start" }}>
        {/* ── Conversation list ──
             Rendered only once threads are known to exist. Titles + relative
             last activity, newest first (engine ordering — never re-sorted). */}
        {threadsAvailable && (
          <nav
            aria-label="Conversations"
            style={{ width: "240px", flexShrink: 0 }}
          >
            <button
              onClick={startNewConversation}
              disabled={isPending || threadLoading}
              style={{
                width: "100%",
                padding: "10px 14px",
                marginBottom: "12px",
                borderRadius: "8px",
                border: "1px solid #00c4b4",
                background: "transparent",
                color: "#00c4b4",
                fontSize: "13px",
                fontWeight: 700,
                cursor: isPending || threadLoading ? "not-allowed" : "pointer",
                textAlign: "left",
              }}
            >
              + New conversation
            </button>
            <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
              {conversations.map((c) => {
                const active = c.id === selectedId;
                return (
                  <li key={c.id} style={{ marginBottom: "6px" }}>
                    <button
                      onClick={() => selectThread(c.id)}
                      disabled={isPending || threadLoading}
                      aria-current={active ? "true" : undefined}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "10px 12px",
                        borderRadius: "8px",
                        border: active ? "1px solid #00c4b4" : "1px solid #1e2d45",
                        background: active ? "rgba(0,196,180,0.08)" : "#0d1626",
                        cursor: isPending || threadLoading ? "not-allowed" : "pointer",
                      }}
                    >
                      <span
                        style={{
                          display: "block",
                          fontSize: "13px",
                          fontWeight: 600,
                          color: active ? "#f1f5f9" : "#cbd5e1",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {c.title ?? "Untitled conversation"}
                      </span>
                      <span
                        style={{
                          display: "block",
                          marginTop: "2px",
                          fontSize: "11px",
                          color: "#64748b",
                        }}
                      >
                        {c.mode === "voice" ? "voice · " : ""}
                        {formatRelative(c.last_message_at)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}

        {/* ── Main column ── */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* ── Example chips (fresh composer only) ── */}
          {!inTranscriptMode && !threadLoading && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "8px",
                marginBottom: "28px",
              }}
            >
              {EXAMPLE_QUESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => submitQuery(q)}
                  disabled={isPending}
                  style={{
                    padding: "6px 14px",
                    borderRadius: "999px",
                    border: "1px solid #1e2d45",
                    background: "transparent",
                    color: "#94a3b8",
                    fontSize: "12px",
                    fontWeight: 500,
                    cursor: isPending ? "not-allowed" : "pointer",
                    transition: "border-color 0.15s, color 0.15s",
                    opacity: isPending ? 0.5 : 1,
                  }}
                  onMouseEnter={(e) => {
                    if (!isPending) {
                      (e.currentTarget as HTMLButtonElement).style.borderColor = "#00c4b4";
                      (e.currentTarget as HTMLButtonElement).style.color = "#00c4b4";
                    }
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLButtonElement).style.borderColor = "#1e2d45";
                    (e.currentTarget as HTMLButtonElement).style.color = "#94a3b8";
                  }}
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          {/* ── Thread loading ── */}
          {threadLoading && (
            <div style={{ ...CARD, padding: "24px", textAlign: "center", marginBottom: "24px" }}>
              <p style={{ margin: 0, fontSize: "13px", color: "#64748b" }}>
                Loading conversation…
              </p>
            </div>
          )}

          {/* ── Transcript ── */}
          {inTranscriptMode && !threadLoading && (
            <div style={{ marginBottom: "24px" }}>
              {transcript!.map((turn) => (
                <div
                  key={turn.key}
                  style={{
                    display: "flex",
                    justifyContent: turn.role === "user" ? "flex-end" : "flex-start",
                    marginBottom: "12px",
                  }}
                >
                  <div
                    style={
                      turn.role === "user"
                        ? {
                            maxWidth: "85%",
                            padding: "12px 16px",
                            borderRadius: "12px",
                            background: "rgba(0,196,180,0.1)",
                            border: "1px solid rgba(0,196,180,0.25)",
                          }
                        : { ...CARD, maxWidth: "92%", padding: "16px 20px" }
                    }
                  >
                    <span
                      style={{
                        display: "block",
                        fontSize: "10px",
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.5px",
                        color: turn.role === "user" ? "#00c4b4" : "#64748b",
                        marginBottom: "6px",
                      }}
                    >
                      {turn.role === "user" ? "You" : "SecureLogic"}
                    </span>
                    <p
                      style={{
                        margin: 0,
                        fontSize: "14px",
                        lineHeight: "1.7",
                        color: "#e2e8f0",
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {turn.content}
                    </p>
                    {turn.role === "assistant" && turn.contextUsed && (
                      <p style={{ margin: "10px 0 0", fontSize: "11px", color: "#334155" }}>
                        {contextCaption(turn.contextUsed)}
                      </p>
                    )}
                    {turn.role === "assistant" && turn.claims && (
                      <ClaimsDetails claims={turn.claims} />
                    )}
                  </div>
                </div>
              ))}

              {/* Proposed mutations from the LIVE turn (ASK-B) — rendered after
                  the transcript, where the answer that proposed them ended. */}
              {!isPending && (
                <ProposalCards
                  proposals={proposals}
                  outcomes={proposalOutcomes}
                  onResolve={resolveProposal}
                />
              )}

              {/* The in-flight question renders immediately; the answer bubble
                  follows when the engine responds. */}
              {isPending && pendingQuestion && (
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "12px" }}>
                  <div
                    style={{
                      maxWidth: "85%",
                      padding: "12px 16px",
                      borderRadius: "12px",
                      background: "rgba(0,196,180,0.1)",
                      border: "1px solid rgba(0,196,180,0.25)",
                    }}
                  >
                    <p style={{ margin: 0, fontSize: "14px", lineHeight: "1.7", color: "#e2e8f0" }}>
                      {pendingQuestion}
                    </p>
                  </div>
                </div>
              )}

              {/* ── Streaming preview (LC-3) ──
                   Deltas for the current model round, replaced by the final
                   answer when it lands (the transcript turn supersedes this
                   bubble). Retrieval activity renders as it happens so a
                   multi-tool turn reads as progress, not a stall. */}
              {isPending && (streamText !== null || streamTools.length > 0) && (
                <div style={{ display: "flex", justifyContent: "flex-start", marginBottom: "12px" }}>
                  <div style={{ ...CARD, maxWidth: "92%", padding: "16px 20px" }}>
                    <span
                      style={{
                        display: "block",
                        fontSize: "10px",
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: "0.5px",
                        color: "#64748b",
                        marginBottom: "6px",
                      }}
                    >
                      SecureLogic
                    </span>
                    {streamTools.length > 0 && (
                      <p style={{ margin: "0 0 8px", fontSize: "11px", color: "#334155" }}>
                        Checked:{" "}
                        {streamTools
                          .map((t) => (t.authorized ? t.tool : `${t.tool} (not accessible)`))
                          .join(", ")}
                      </p>
                    )}
                    <p
                      style={{
                        margin: 0,
                        fontSize: "14px",
                        lineHeight: "1.7",
                        color: "#e2e8f0",
                        whiteSpace: "pre-wrap",
                      }}
                    >
                      {streamText}
                      <span style={{ color: "#00c4b4" }}>▍</span>
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {composer}

          {/* ── Recording error ──
               Render priority: code → mapped string; otherwise the server's
               `message` if present (also covers local-only codes like
               microphone_denied that carry their own user-facing text);
               otherwise generic fallback. */}
          {recordingError && !isRecording && !isTranscribing && (
            <div
              style={{
                ...CARD,
                padding: "14px 18px",
                borderColor: "rgba(239,68,68,0.3)",
                background: "rgba(239,68,68,0.07)",
                marginBottom: "16px",
              }}
            >
              <p style={{ margin: 0, fontSize: "13px", color: "#fca5a5" }}>
                {(recordingError.code && TRANSCRIBE_ERROR_MESSAGES[recordingError.code]) ??
                  recordingError.message ??
                  TRANSCRIBE_FALLBACK}
              </p>

              {/* ── Diagnostic code (non-sensitive) ──
                   A compact, screenshot-friendly trace of this voice attempt so we
                   can diagnose iPad failures from one real attempt. Contains only
                   codes, mime strings, byte sizes, an HTTP status, and a random
                   correlation id — no audio, secrets, or PII. */}
              {diagnostic && (
                <details style={{ marginTop: "10px" }}>
                  <summary
                    style={{
                      cursor: "pointer",
                      fontSize: "11px",
                      color: "#94a3b8",
                      userSelect: "none",
                    }}
                  >
                    Diagnostic details (share with support)
                  </summary>
                  <code
                    style={{
                      display: "block",
                      marginTop: "8px",
                      padding: "10px 12px",
                      background: "#0a0f1a",
                      border: "1px solid #1e2d45",
                      borderRadius: "6px",
                      fontSize: "11px",
                      lineHeight: "1.5",
                      color: "#94a3b8",
                      wordBreak: "break-all",
                      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                    }}
                  >
                    {buildDiagnosticCode(diagnostic)}
                  </code>
                </details>
              )}
            </div>
          )}

          {/* ── Loading state (single-shot only — the transcript shows the
               in-flight question inline instead) ── */}
          {isPending && !inTranscriptMode && !threadLoading && (
            <div
              style={{
                ...CARD,
                padding: "32px 24px",
                textAlign: "center",
                marginBottom: "24px",
              }}
            >
              <div
                style={{
                  width: "32px",
                  height: "32px",
                  borderRadius: "50%",
                  border: "3px solid #1e2d45",
                  borderTopColor: "#00c4b4",
                  animation: "spin 0.8s linear infinite",
                  margin: "0 auto 16px",
                }}
              />
              <p style={{ margin: 0, fontSize: "14px", color: "#64748b" }}>
                Analyzing your posture data…
              </p>
              {/* Streaming preview (LC-3) — first question on a fresh page runs
                  before transcript mode exists, so the preview lives here too. */}
              {streamTools.length > 0 && (
                <p style={{ margin: "12px 0 0", fontSize: "11px", color: "#334155" }}>
                  Checked:{" "}
                  {streamTools
                    .map((t) => (t.authorized ? t.tool : `${t.tool} (not accessible)`))
                    .join(", ")}
                </p>
              )}
              {streamText !== null && streamText.length > 0 && (
                <p
                  style={{
                    margin: "16px 0 0",
                    fontSize: "14px",
                    lineHeight: "1.7",
                    color: "#e2e8f0",
                    whiteSpace: "pre-wrap",
                    textAlign: "left",
                  }}
                >
                  {streamText}
                  <span style={{ color: "#00c4b4" }}>▍</span>
                </p>
              )}
            </div>
          )}

          {/* ── Error state ──
               Render priority: code → mapped string; otherwise the server's
               `message` if present; otherwise generic fallback. The raw
               code/status was already console.error'd at the submit site. */}
          {error && !isPending && (
            <div
              style={{
                ...CARD,
                padding: "20px 24px",
                borderColor: "rgba(239,68,68,0.3)",
                background: "rgba(239,68,68,0.07)",
                marginBottom: "24px",
              }}
            >
              <p style={{ margin: 0, fontSize: "14px", color: "#fca5a5" }}>
                {(error.code && ASK_ERROR_MESSAGES[error.code]) ??
                  error.message ??
                  ASK_FALLBACK}
              </p>
            </div>
          )}

          {/* ── Single-shot answer display (engines without conversations) ── */}
          {answer && !isPending && !inTranscriptMode && (
            <>
            <div style={{ ...CARD, padding: "28px 28px 24px", marginBottom: "24px" }}>
              <p
                style={{
                  margin: "0 0 20px",
                  fontSize: "15px",
                  lineHeight: "1.75",
                  color: "#e2e8f0",
                  whiteSpace: "pre-wrap",
                }}
              >
                {answer.answer}
              </p>

              {answer.provenance && normalizeClaims(answer.provenance.claims) && (
                <ClaimsDetails claims={normalizeClaims(answer.provenance.claims)!} />
              )}

              <div
                style={{
                  paddingTop: "16px",
                  marginTop: "16px",
                  borderTop: "1px solid #1e2d45",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "8px",
                }}
              >
                <span style={{ fontSize: "11px", color: "#334155" }}>
                  {contextCaption(answer.context_used) ?? ""}
                </span>
                <button
                  onClick={reset}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "#00c4b4",
                    padding: 0,
                  }}
                >
                  Ask another question →
                </button>
              </div>
            </div>

            {/* Proposed mutations from this answer (ASK-B). */}
            <ProposalCards
              proposals={proposals}
              outcomes={proposalOutcomes}
              onResolve={resolveProposal}
            />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
