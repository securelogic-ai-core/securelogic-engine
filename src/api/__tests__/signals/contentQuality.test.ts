/**
 * contentQuality.test.ts — Intelligence Pipeline Hardening / IE.P2.
 *
 * Pins the "never display broken sentences" contract: truncation/malformed
 * detection, recovery to whole sentences, explicit marking when unrecoverable,
 * and sentence-safe length capping (the replacement for slice(0,497)+"…").
 */

import { describe, it, expect } from "vitest";
import {
  assessContent,
  trimToSentence,
  TRUNCATION_MARKER
} from "../../lib/signals/contentQuality.js";

describe("assessContent", () => {
  it("marks a whole-sentence input complete and leaves it intact", () => {
    const r = assessContent("A critical RCE affects Acme Gateway. Patch immediately.");
    expect(r.status).toBe("complete");
    expect(r.truncated).toBe(false);
    expect(r.displayText).toBe("A critical RCE affects Acme Gateway. Patch immediately.");
  });

  it("degrades empty / prose-less input", () => {
    expect(assessContent("").status).toBe("degraded");
    expect(assessContent("   ").status).toBe("degraded");
    expect(assessContent("...").status).toBe("degraded");
    expect(assessContent("— …").displayText).toBe("");
  });

  it("recovers to whole sentences when the tail is a mid-sentence fragment", () => {
    const r = assessContent("Acme disclosed a breach. Attackers accessed cus");
    expect(r.status).toBe("truncated");
    expect(r.truncated).toBe(true);
    expect(r.reason).toBe("mid_sentence");
    expect(r.displayText).toBe("Acme disclosed a breach.");
  });

  it("treats a trailing ellipsis as truncation and trims to the last whole sentence", () => {
    const r = assessContent("CISA added CVE-2026-1 to KEV. Exploitation ongoing...");
    expect(r.status).toBe("truncated");
    expect(r.reason).toBe("ellipsis");
    // The ellipsis-stripped tail "Exploitation ongoing" is not a whole sentence,
    // so we fall back to the last complete sentence — never a broken tail.
    expect(r.displayText).toBe("CISA added CVE-2026-1 to KEV.");
  });

  it("keeps a single broken fragment but marks it explicitly (no clean sentence to recover)", () => {
    const r = assessContent("Threat actors exploiting a zero-day in the wild aga");
    expect(r.status).toBe("truncated");
    expect(r.reason).toBe("no_sentence_boundary");
    expect(r.displayText.endsWith(TRUNCATION_MARKER)).toBe(true);
    expect(r.displayText).toContain("Threat actors");
  });

  it("never returns a bare mid-word fragment presented as complete", () => {
    const r = assessContent("Something happen");
    expect(r.status).not.toBe("complete");
    // Either recovered to a sentence or explicitly marked — never a bare fragment.
    expect(r.displayText === "" || r.displayText.endsWith(TRUNCATION_MARKER)).toBe(true);
  });

  it("normalizes whitespace", () => {
    expect(assessContent("Line one.\n\n  Line two.").displayText).toBe("Line one. Line two.");
  });
});

describe("trimToSentence", () => {
  const long =
    "First sentence is short. Second sentence adds important context about the exploit. Third sentence is extra detail that overflows the budget entirely and keeps going well past.";

  it("returns text unchanged when within budget", () => {
    expect(trimToSentence("Short and complete.", 100)).toBe("Short and complete.");
  });

  it("caps at the last full sentence that fits the budget", () => {
    const r = trimToSentence(long, 60);
    expect(r).toBe("First sentence is short.");
    expect(r.length).toBeLessThanOrEqual(60);
  });

  it("falls back to a word boundary + explicit marker when no sentence fits", () => {
    const r = trimToSentence("alpha beta gamma delta epsilon zeta eta theta iota kappa", 20);
    expect(r.endsWith(TRUNCATION_MARKER)).toBe(true);
    // Body is whole words only — no mid-word cut when a space boundary exists.
    const body = r.slice(0, r.length - TRUNCATION_MARKER.length);
    expect(body).toBe("alpha beta gamma");
  });

  it("is display-safe: capped output is itself complete or explicitly marked", () => {
    const r = trimToSentence(long, 80);
    const q = assessContent(r);
    expect(q.status === "complete" || r.endsWith(TRUNCATION_MARKER)).toBe(true);
  });
});
