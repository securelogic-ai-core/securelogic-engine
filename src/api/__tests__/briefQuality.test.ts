/**
 * briefQuality.test.ts — IQP Q4 regression suite (Phase 1 audit defects
 * #1 — 77-char mid-word title cuts with a literal "..." — and #2 — summaries
 * that merely repeat the title).
 *
 * Under SECURELOGIC_BRIEF_QUALITY_ENABLED:
 *   1. titles cap at 120 chars on a word/sentence boundary (trimToSentence);
 *   2. the normalizer's derived summary is sentence-safe (no slice+"...");
 *   3. summary that restates the title → deterministic entity synthesis;
 *   4. duplicate titles across one brief collapse (G2).
 * Flag OFF ⇒ all four behaviors byte-identical to legacy.
 */

import { describe, it, expect } from "vitest";
import { briefQualityEnabled } from "../lib/briefQualityFeatureFlag.js";
import { deriveSummaryFromPayload, normalizeSignal } from "../lib/cyberSignalNormalizer.js";
import {
  buildBriefItems,
  restatesTitle,
  synthesizeSummaryFromEntities,
  type CyberSignalForBrief
} from "../lib/intelligenceBriefGenerator.js";
import type { CyberSignalIngestInput } from "../lib/cyberSignalValidation.js";

const LONG_HEADLINE =
  "Critical zero-day vulnerability in enterprise VPN appliances actively exploited by ransomware operators targeting healthcare and financial services organizations worldwide";

function sig(overrides: Partial<CyberSignalForBrief> = {}): CyberSignalForBrief {
  return {
    id: `sig-${Math.abs(JSON.stringify(overrides).split("").reduce((a, c) => a + c.charCodeAt(0), 0))}`,
    source: "bleepingcomputer",
    signal_type: "advisory",
    severity: "High",
    normalized_summary: "A distinct executive summary of the event.",
    affected_cve: null,
    affected_vendor: null,
    raw_payload: { title: "Short headline" },
    ingestion_timestamp: "2026-07-08T00:00:00.000Z",
    cluster_key: null,
    ...overrides
  } as CyberSignalForBrief;
}

describe("briefQualityEnabled — dark by default", () => {
  it("OFF for absent env; ON only for exact 'true'", () => {
    expect(briefQualityEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(briefQualityEnabled({ SECURELOGIC_BRIEF_QUALITY_ENABLED: "true" } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(briefQualityEnabled({ SECURELOGIC_BRIEF_QUALITY_ENABLED: "yes" } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// #1 — title cap
// ---------------------------------------------------------------------------

describe("title cap — defect #1", () => {
  it("flag OFF: legacy 77-char mid-word cut with literal '...' (byte-identical)", () => {
    const [item] = buildBriefItems([sig({ raw_payload: { title: LONG_HEADLINE } })], undefined, false, false, false, false);
    expect(item!.title).toBe(`${LONG_HEADLINE.slice(0, 77)}...`);
  });

  it("flag ON: caps at ≤120+marker on a WORD boundary — no mid-word cut, no bare '...'", () => {
    const [item] = buildBriefItems([sig({ raw_payload: { title: LONG_HEADLINE } })], undefined, false, false, false, true);
    expect(item!.title.length).toBeLessThanOrEqual(125); // 120 + " […]"
    expect(item!.title.endsWith("ationwide...")).toBe(false);
    expect(/\.\.\.$/.test(item!.title)).toBe(false);
    // Every word in the title must be a whole word from the source headline.
    const body = item!.title.replace(/ \[…\]$/, "");
    expect(LONG_HEADLINE.startsWith(body)).toBe(true);
    expect(LONG_HEADLINE[body.length]).toBe(" "); // cut exactly at a word gap
  });

  it("flag ON: short titles pass through whole (no marker)", () => {
    const [item] = buildBriefItems([sig()], undefined, false, false, false, true);
    expect(item!.title).toBe("Short headline");
  });
});

// ---------------------------------------------------------------------------
// #1 — normalizer summary derivation
// ---------------------------------------------------------------------------

describe("deriveSummaryFromPayload — sentence-safe cap", () => {
  const longDesc =
    "First sentence of the advisory describing the vulnerability. ".repeat(8) +
    "Second-half sentence that will not fit in the five hundred character budget at all.";

  it("flag OFF: legacy slice(0,497)+'...' (byte-identical broken sentence)", () => {
    const out = deriveSummaryFromPayload({ description: longDesc }, "cve", null, null, false);
    expect(out).toBe(`${longDesc.trim().slice(0, 497)}...`);
  });

  it("flag ON: ends on a complete sentence, ≤500 chars, no bare ellipsis", () => {
    const out = deriveSummaryFromPayload({ description: longDesc }, "cve", null, null, true);
    expect(out.length).toBeLessThanOrEqual(500);
    expect(/[.!?]$/.test(out)).toBe(true);
    expect(out.endsWith("...")).toBe(false);
  });

  it("normalizeSignal threads the quality flag to the derive path", () => {
    const input: CyberSignalIngestInput = {
      source: "nvd",
      signal_type: "cve",
      severity: "High",
      raw_payload: { description: longDesc },
      normalized_summary: null,
      affected_vendor: null,
      affected_cve: "CVE-2026-1111",
      external_id: null
    };
    const at = new Date("2026-07-08T00:00:00Z");
    const legacy = normalizeSignal(input, at, false, false);
    const quality = normalizeSignal(input, at, false, true);
    expect(legacy.normalized_summary.endsWith("...")).toBe(true);
    expect(/[.!?]$/.test(quality.normalized_summary)).toBe(true);
    expect(quality.normalized_summary.endsWith("...")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// #2 — summary must not restate the title
// ---------------------------------------------------------------------------

describe("restatesTitle / synthesizeSummaryFromEntities — defect #2", () => {
  it("detects exact restatement (case/whitespace-insensitive)", () => {
    expect(restatesTitle("Patch Now: VPN Flaw", "patch now:  vpn flaw")).toBe(true);
  });

  it("detects prefix restatement in both directions (truncation shapes)", () => {
    expect(restatesTitle("VPN flaw exploited", "VPN flaw exploited in the wild by actors")).toBe(true);
    expect(restatesTitle("VPN flaw exploited in the wild by actors...", "VPN flaw exploited")).toBe(true);
  });

  it("a genuinely distinct summary is NOT a restatement", () => {
    expect(restatesTitle("VPN flaw exploited", "CISA directs agencies to patch within seven days.")).toBe(false);
  });

  it("synthesized summary states severity + kind + entities and never copies the title", () => {
    const s = synthesizeSummaryFromEntities({
      signal_type: "third_party_breach",
      severity: "High",
      affected_cve: null,
      affected_vendor: "Okta"
    });
    expect(s).toBe(
      "High-severity third-party breach disclosure affecting Okta. Review the source advisory for scope, exposure, and remediation guidance."
    );
  });

  it("flag ON: an item whose summary == title gets the synthesized summary", () => {
    const [item] = buildBriefItems(
      [sig({ raw_payload: { title: "Okta breach disclosed" }, normalized_summary: "Okta breach disclosed", signal_type: "breach", affected_vendor: "Okta" })],
      undefined, false, false, false, true
    );
    expect(item!.summary).toBe(
      "High-severity security incident affecting Okta. Review the source advisory for scope, exposure, and remediation guidance."
    );
    expect(item!.title).toBe("Okta breach disclosed");
  });

  it("flag OFF: the restating summary is preserved byte-identically", () => {
    const [item] = buildBriefItems(
      [sig({ raw_payload: { title: "Okta breach disclosed" }, normalized_summary: "Okta breach disclosed" })],
      undefined, false, false, false, false
    );
    expect(item!.summary).toBe("Okta breach disclosed");
  });
});

// ---------------------------------------------------------------------------
// G2 — duplicate-title collapse
// ---------------------------------------------------------------------------

describe("duplicate-title collapse — gate G2", () => {
  const a = sig({ raw_payload: { title: "Same Story Headline" }, normalized_summary: "From source A.", ingestion_timestamp: "2026-07-08T02:00:00.000Z" });
  const b = sig({ raw_payload: { title: "same story headline" }, normalized_summary: "From source B.", ingestion_timestamp: "2026-07-08T01:00:00.000Z", source: "krebsonsecurity" });

  it("flag ON: case-insensitive duplicate titles collapse to the first (best-ranked) item", () => {
    const items = buildBriefItems([a, b], undefined, false, false, false, true);
    expect(items).toHaveLength(1);
    expect(items[0]!.summary).toBe("From source A."); // more recent wins the sort
  });

  it("flag OFF: both items remain (byte-identical legacy)", () => {
    const items = buildBriefItems([a, b], undefined, false, false, false, false);
    expect(items).toHaveLength(2);
  });

  it("distinct titles are never collapsed", () => {
    const c = sig({ raw_payload: { title: "A different headline" } });
    const items = buildBriefItems([a, c], undefined, false, false, false, true);
    expect(items).toHaveLength(2);
  });
});
