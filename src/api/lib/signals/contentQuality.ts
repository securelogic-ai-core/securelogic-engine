/**
 * contentQuality.ts — content-quality gating for Intelligence Events.
 * Intelligence Pipeline Hardening / IE.P2 (design memo IE-INTELLIGENCE-EVENTS-MEMO.md).
 *
 * Goal item 6: "Reject incomplete or malformed intelligence. Detect truncation,
 * parsing failures, and partial summaries. Either recover the full content or
 * clearly indicate intentional truncation. Never display broken sentences."
 *
 * The legacy path (cyberSignalNormalizer.deriveSummaryFromPayload) truncates feed
 * text at 500 chars and appends "…", which produces exactly the broken sentences
 * this module forbids. These are PURE functions with no I/O:
 *
 *   assessContent(raw)       → classify + a display-safe rendering of the text.
 *   trimToSentence(text, n)  → length-cap at a sentence boundary, never mid-word.
 *
 * "Display-safe" means: the returned text ends on a complete sentence (or is
 * explicitly, visibly marked as truncated). We never present a mid-word or
 * mid-sentence fragment as if it were whole.
 */

export type ContentStatus = "complete" | "truncated" | "degraded";

export interface ContentQuality {
  /**
   * complete  — ends on a terminal sentence; usable as-is.
   * truncated — the source was cut short; displayText is trimmed to whole
   *             sentences, or explicitly marked when no sentence boundary exists.
   * degraded  — empty, or no usable prose (parsing failure / punctuation-only).
   */
  readonly status: ContentStatus;
  /** Clean, display-safe text — whole sentences only, or an explicit marker. */
  readonly displayText: string;
  /** True when the source text was cut short (ellipsis or mid-sentence). */
  readonly truncated: boolean;
  /** Stable machine-readable reason ("" when complete). */
  readonly reason: string;
}

/** Explicit, visible marker appended only when truncation cannot be cleaned away. */
export const TRUNCATION_MARKER = " […]";

/** A trailing ellipsis ("..." or "…"), the classic mechanical-truncation tell. */
const TRAILING_ELLIPSIS = /(\.{3}|…)\s*$/;

/**
 * Terminal sentence punctuation optionally followed by a closing quote/bracket,
 * at end of string. Matches "done." / "done!" / (done.) / "quote."
 */
const ENDS_TERMINAL = /[.!?]["'”’)\]]*$/;

/** All sentence-ending boundaries: terminal punctuation + optional closer. */
const SENTENCE_BOUNDARY = /[.!?]["'”’)\]]*(?=\s|$)/g;

/** Has at least one letter or digit (i.e. is not punctuation/whitespace only). */
const HAS_PROSE = /[\p{L}\p{N}]/u;

/** Collapse all whitespace runs to single spaces and trim. */
function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Index just past the last complete sentence in `text`, or -1 if none. */
function lastSentenceEnd(text: string): number {
  let end = -1;
  for (const m of text.matchAll(SENTENCE_BOUNDARY)) {
    end = m.index + m[0].length;
  }
  return end;
}

/**
 * Assess a raw piece of feed/advisory text and return a display-safe rendering.
 *
 * - Empty / prose-less input → `degraded`, empty displayText.
 * - Ends on a full sentence → `complete`, text unchanged (whitespace-normalized).
 * - Cut short (trailing ellipsis, or does not end on terminal punctuation) →
 *   `truncated`: displayText is trimmed back to the last WHOLE sentence; if there
 *   is no whole sentence to fall back to, the fragment is kept but the visible
 *   TRUNCATION_MARKER is appended so it is never mistaken for complete text.
 */
export function assessContent(raw: string | null | undefined): ContentQuality {
  const text = normalizeWhitespace(raw ?? "");

  if (text === "" || !HAS_PROSE.test(text)) {
    return { status: "degraded", displayText: "", truncated: false, reason: text === "" ? "empty" : "no_prose" };
  }

  const hadEllipsis = TRAILING_ELLIPSIS.test(text);
  const core = text.replace(TRAILING_ELLIPSIS, "").trimEnd();
  const endsTerminal = ENDS_TERMINAL.test(core);

  if (!hadEllipsis && endsTerminal) {
    return { status: "complete", displayText: core, truncated: false, reason: "" };
  }

  // Truncated: prefer trimming back to the last complete sentence.
  const end = lastSentenceEnd(core);
  if (end > 0) {
    return {
      status: "truncated",
      displayText: core.slice(0, end).trimEnd(),
      truncated: true,
      reason: hadEllipsis ? "ellipsis" : "mid_sentence"
    };
  }

  // No sentence boundary to recover — keep the fragment but mark it explicitly so
  // it can never read as whole. Never present a bare broken sentence.
  return {
    status: "truncated",
    displayText: core + TRUNCATION_MARKER,
    truncated: true,
    reason: "no_sentence_boundary"
  };
}

/**
 * Cap `text` at `maxLen` characters WITHOUT breaking a sentence or a word.
 *
 * - Already within budget → returned unchanged (whitespace-normalized).
 * - Otherwise trim to the last sentence boundary that fits; if none fits, trim to
 *   the last WORD boundary that fits and append the visible TRUNCATION_MARKER.
 *
 * This is the display-safe replacement for the mechanical `slice(0, 497) + "…"`.
 */
export function trimToSentence(text: string, maxLen: number): string {
  const t = normalizeWhitespace(text);
  if (maxLen <= 0) return "";
  if (t.length <= maxLen) return t;

  const window = t.slice(0, maxLen);

  const sentenceEnd = lastSentenceEnd(window);
  if (sentenceEnd > 0) {
    return window.slice(0, sentenceEnd).trimEnd();
  }

  // No full sentence fits — fall back to the last word boundary + explicit marker.
  const lastSpace = window.lastIndexOf(" ");
  const body = (lastSpace > 0 ? window.slice(0, lastSpace) : window).trimEnd();
  return body + TRUNCATION_MARKER;
}
