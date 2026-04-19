"use client";

import { useState, useRef, useCallback, useEffect, useTransition } from "react";
import { askAction } from "./actions";
import type { AskResponse } from "@/lib/api";
import { transcribeAudio } from "@/lib/api";

// ─────────────────────────────────────────────────────────────
// Example chips
// ─────────────────────────────────────────────────────────────

const EXAMPLE_QUESTIONS = [
  "What are my top 3 vendors by risk exposure?",
  "Show me my critical open findings",
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
// Metadata line helper
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

// ─────────────────────────────────────────────────────────────
// Mic SVG
// ─────────────────────────────────────────────────────────────

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

export function AskClient({ initialToken }: { initialToken: string }) {
  const [query, setQuery]           = useState("");
  const [answer, setAnswer]         = useState<AskResponse | null>(null);
  const [error, setError]           = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const textareaRef                 = useRef<HTMLTextAreaElement | null>(null);

  const [isRecording, setIsRecording]     = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef   = useRef<Blob[]>([]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [query]);

  const submitQuery = useCallback(
    (text: string) => {
      const q = text.trim();
      if (!q || isPending) return;
      setError(null);
      setAnswer(null);
      startTransition(async () => {
        const result = await askAction(q);
        if ("error" in result) {
          setError(result.error);
        } else {
          setAnswer(result);
        }
      });
    },
    [isPending]
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
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, []);

  const toggleRecording = useCallback(async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      return;
    }

    setRecordingError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setIsRecording(false);
        setIsTranscribing(true);

        const mimeType = mediaRecorder.mimeType || "audio/webm";
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });

        try {
          const result = await transcribeAudio(initialToken, audioBlob, mimeType);
          if (result?.text) {
            setQuery(result.text);
            submitQuery(result.text);
          } else {
            setRecordingError("Could not transcribe audio. Please try again.");
          }
        } finally {
          setIsTranscribing(false);
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch {
      setRecordingError(
        "Microphone access denied. Please allow microphone access and try again."
      );
    }
  }, [isRecording, initialToken, submitQuery]);

  return (
    <div style={{ maxWidth: "720px", margin: "0 auto", padding: "48px 24px" }}>
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

      {/* ── Example chips ── */}
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

      {/* ── Input area ── */}
      <div style={{ ...CARD, padding: "20px", marginBottom: "24px" }}>
        <textarea
          ref={(el) => { textareaRef.current = el; }}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={3}
          placeholder="Ask a question about your risk posture..."
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
            {/* ── Microphone button ── */}
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
      </div>

      {/* ── Recording error ── */}
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
            {recordingError}
          </p>
        </div>
      )}

      {/* ── Loading state ── */}
      {isPending && (
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
        </div>
      )}

      {/* ── Error state ── */}
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
            Unable to process your question. Please try again.
          </p>
        </div>
      )}

      {/* ── Answer display ── */}
      {answer && !isPending && (
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

          <div
            style={{
              paddingTop: "16px",
              borderTop: "1px solid #1e2d45",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "8px",
            }}
          >
            <span style={{ fontSize: "11px", color: "#334155" }}>
              {answer.context_used.posture_score != null
                ? `Posture score ${answer.context_used.posture_score}`
                : "No posture snapshot"}
              {" · "}
              {answer.context_used.findings_count} open findings
              {" · "}
              {answer.context_used.risks_count} risks
              {answer.context_used.as_of
                ? ` · as of ${formatDate(answer.context_used.as_of)}`
                : ""}
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
      )}
    </div>
  );
}
