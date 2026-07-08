/**
 * signalSanitize.test.ts — IQP Q1 regression suite (Phase 1 audit defect #3:
 * raw feed HTML persisted into normalized_summary / brief titles and rendered
 * to customers as literal visible tags).
 *
 * Covers the ONE sanitization truth (stripHtmlToText) and its exactly-two
 * wiring points:
 *   1. normalizeSignal — stored summary of every new signal (both routes:
 *      caller-supplied and payload-derived), and
 *   2. buildBriefItems / buildItemTitle — title from RAW raw_payload.title +
 *      summary covering legacy in-window rows.
 * Plus the flag-off byte-identity guarantee (dark-launch discipline).
 */

import { describe, it, expect } from "vitest";
import { stripHtmlToText } from "../lib/sanitize.js";
import { signalSanitizeEnabled } from "../lib/signalSanitizeFeatureFlag.js";
import { normalizeSignal } from "../lib/cyberSignalNormalizer.js";
import { buildBriefItems, type CyberSignalForBrief } from "../lib/intelligenceBriefGenerator.js";
import type { CyberSignalIngestInput } from "../lib/cyberSignalValidation.js";

// ---------------------------------------------------------------------------
// stripHtmlToText — unit
// ---------------------------------------------------------------------------

describe("stripHtmlToText", () => {
  it("strips simple tags, keeping inner text", () => {
    expect(stripHtmlToText("A <b>critical</b> flaw in <i>OpenSSL</i>")).toBe(
      "A critical flaw in OpenSSL"
    );
  });

  it("replaces <br> and <p> with spaces (no word gluing)", () => {
    expect(stripHtmlToText("line one<br>line two<p>line three</p>")).toBe(
      "line one line two line three"
    );
  });

  it("drops <script> and <style> elements INCLUDING their content", () => {
    expect(stripHtmlToText('before<script>alert("x")</script>after')).toBe("before after");
    expect(stripHtmlToText("a<style>.x{color:red}</style>b")).toBe("a b");
  });

  it("decodes named entities common in RSS text", () => {
    expect(stripHtmlToText("Patch&nbsp;now &amp; verify &lt;today&gt;")).toBe(
      "Patch now & verify <today>"
    );
  });

  it("decodes decimal and hex numeric entities", () => {
    expect(stripHtmlToText("It&#8217;s fixed")).toBe("It’s fixed");
    expect(stripHtmlToText("It&#x27;s fixed")).toBe("It's fixed");
  });

  it("leaves unknown named entities untouched (no over-eager decoding)", () => {
    expect(stripHtmlToText("&unknownentity; stays")).toBe("&unknownentity; stays");
  });

  it("removes paired markdown emphasis markers, keeping inner text", () => {
    expect(stripHtmlToText("**Actively exploited** in __the wild__")).toBe(
      "Actively exploited in the wild"
    );
  });

  it("leaves unpaired markdown markers untouched (conservative)", () => {
    expect(stripHtmlToText("rated **high")).toBe("rated **high");
  });

  it("collapses whitespace runs and trims", () => {
    expect(stripHtmlToText("  a \n\n b\t c  ")).toBe("a b c");
  });

  it("passes plain text through unchanged (idempotent on clean input)", () => {
    const clean = "CISA adds CVE-2026-1234 to the KEV catalog; patch within 7 days.";
    expect(stripHtmlToText(clean)).toBe(clean);
    expect(stripHtmlToText(stripHtmlToText(clean))).toBe(clean);
  });

  it("is idempotent on its own output for markup-heavy input", () => {
    const once = stripHtmlToText("<p>A &amp; B<br/><b>C</b></p>");
    expect(stripHtmlToText(once)).toBe(once);
  });
});

// ---------------------------------------------------------------------------
// Feature flag — default OFF
// ---------------------------------------------------------------------------

describe("signalSanitizeEnabled", () => {
  it("is OFF by default (absent env)", () => {
    expect(signalSanitizeEnabled({} as NodeJS.ProcessEnv)).toBe(false);
  });

  it("is ON only for the exact string 'true'", () => {
    expect(signalSanitizeEnabled({ SECURELOGIC_SIGNAL_SANITIZE_ENABLED: "true" } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(signalSanitizeEnabled({ SECURELOGIC_SIGNAL_SANITIZE_ENABLED: "TRUE" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(signalSanitizeEnabled({ SECURELOGIC_SIGNAL_SANITIZE_ENABLED: "1" } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// normalizeSignal — ingest wiring
// ---------------------------------------------------------------------------

const HTML_SUMMARY = "Microsoft patches <b>critical</b> flaw&nbsp;&#8211; act now<br/>";

function ingestInput(overrides: Partial<CyberSignalIngestInput> = {}): CyberSignalIngestInput {
  return {
    source: "cisa_alerts",
    signal_type: "advisory",
    severity: "High",
    raw_payload: { title: "t" },
    normalized_summary: HTML_SUMMARY,
    affected_vendor: null,
    affected_cve: null,
    external_id: "guid-1",
    ...overrides
  };
}

describe("normalizeSignal — IQP Q1 wiring", () => {
  const at = new Date("2026-07-08T00:00:00Z");

  it("flag OFF (default): stored summary is byte-identical to input (markup preserved)", () => {
    const out = normalizeSignal(ingestInput(), at, false);
    expect(out.normalized_summary).toBe(HTML_SUMMARY);
  });

  it("flag ON: caller-supplied summary is sanitized to plain text", () => {
    const out = normalizeSignal(ingestInput(), at, true);
    expect(out.normalized_summary).toBe("Microsoft patches critical flaw – act now");
  });

  it("flag ON: payload-DERIVED summary route is sanitized too", () => {
    const out = normalizeSignal(
      ingestInput({
        normalized_summary: null,
        raw_payload: { description: "Exploit &amp; patch <i>details</i> here" }
      }),
      at,
      true
    );
    expect(out.normalized_summary).toBe("Exploit & patch details here");
  });

  it("flag ON: raw_payload is NOT mutated (provenance stays raw)", () => {
    const payload = { title: "<b>raw</b>" };
    const out = normalizeSignal(ingestInput({ raw_payload: payload }), at, true);
    expect(out.raw_payload).toBe(payload);
    expect((out.raw_payload as Record<string, unknown>)["title"]).toBe("<b>raw</b>");
  });

  it("flag ON: dedup_hash is unaffected (hash inputs exclude the summary)", () => {
    const off = normalizeSignal(ingestInput(), at, false);
    const on = normalizeSignal(ingestInput(), at, true);
    expect(on.dedup_hash).toBe(off.dedup_hash);
    expect(on.cluster_key).toBe(off.cluster_key);
  });
});

// ---------------------------------------------------------------------------
// buildBriefItems — brief-item boundary wiring
// ---------------------------------------------------------------------------

function briefSignal(overrides: Partial<CyberSignalForBrief> = {}): CyberSignalForBrief {
  return {
    id: "sig-1",
    source: "cisa_alerts",
    signal_type: "advisory",
    severity: "High",
    normalized_summary: "Summary with <b>markup</b> &amp; entities",
    affected_cve: null,
    affected_vendor: null,
    raw_payload: { title: "Title with <i>tags</i>&nbsp;inside" },
    ingestion_timestamp: "2026-07-08T00:00:00.000Z",
    cluster_key: null,
    ...overrides
  } as CyberSignalForBrief;
}

describe("buildBriefItems — IQP Q1 wiring", () => {
  it("flag OFF: title and summary are byte-identical to pre-Q1 output", () => {
    const [item] = buildBriefItems([briefSignal()], undefined, false, false);
    expect(item!.title).toBe("Title with <i>tags</i>&nbsp;inside");
    expect(item!.summary).toBe("Summary with <b>markup</b> &amp; entities");
  });

  it("flag ON: title derived from RAW raw_payload.title is sanitized", () => {
    const [item] = buildBriefItems([briefSignal()], undefined, false, true);
    expect(item!.title).toBe("Title with tags inside");
  });

  it("flag ON: summary is sanitized (covers legacy pre-flag rows in window)", () => {
    const [item] = buildBriefItems([briefSignal()], undefined, false, true);
    expect(item!.summary).toBe("Summary with markup & entities");
  });

  it("flag ON: title fallback from normalized_summary is sanitized too", () => {
    const [item] = buildBriefItems(
      [briefSignal({ raw_payload: {} , normalized_summary: "<p>Fallback &amp; title text</p>" })],
      undefined,
      false,
      true
    );
    expect(item!.title).toBe("Fallback & title text");
    expect(item!.summary).toBe("Fallback & title text");
  });
});
