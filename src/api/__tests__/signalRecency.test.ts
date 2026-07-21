/**
 * signalRecency.test.ts — IQP Q2 regression suite (Phase 1 audit defect #4:
 * very old vulnerabilities — e.g. CVE-2008-4250 — surfaced as current because
 * recency was conflated with ingestion time).
 *
 * Covers:
 *   - derivePublishedAt: source-authoritative date extraction per source
 *     family, priority order, and the bounds guard (mirrors the 20260828
 *     backfill migration).
 *   - normalizeSignal: published_at threaded onto the normalized record —
 *     including that an ANCIENT date is PRESERVED at write time (suppression
 *     is a read-time decision under SECURELOGIC_SIGNAL_RECENCY_ENABLED).
 *   - signalRecencyEnabled: OFF by default (dark-launch discipline).
 */

import { describe, it, expect } from "vitest";
import { derivePublishedAt, normalizeSignal } from "../lib/cyberSignalNormalizer.js";
import { signalRecencyEnabled } from "../lib/signalRecencyFeatureFlag.js";
import type { CyberSignalIngestInput } from "../lib/cyberSignalValidation.js";

const NOW = new Date("2026-07-08T12:00:00Z");

describe("derivePublishedAt — source-authoritative date extraction", () => {
  it("CISA KEV: dateAdded (date-only) parses", () => {
    expect(derivePublishedAt({ dateAdded: "2026-07-01" }, NOW)).toBe("2026-07-01T00:00:00.000Z");
  });

  it("NVD: published (ISO datetime) parses", () => {
    expect(derivePublishedAt({ published: "2026-07-02T08:30:00.000Z" }, NOW)).toBe(
      "2026-07-02T08:30:00.000Z"
    );
  });

  it("RSS: pubDate (RFC 822) parses", () => {
    expect(derivePublishedAt({ pubDate: "Tue, 07 Jul 2026 10:00:00 GMT" }, NOW)).toBe(
      "2026-07-07T10:00:00.000Z"
    );
  });

  it("Federal Register: publication_date parses", () => {
    expect(derivePublishedAt({ publication_date: "2026-06-30" }, NOW)).toBe(
      "2026-06-30T00:00:00.000Z"
    );
  });

  it("SEC EDGAR: file_date parses", () => {
    expect(derivePublishedAt({ file_date: "2026-07-03" }, NOW)).toBe("2026-07-03T00:00:00.000Z");
  });

  it("priority order: dateAdded wins over pubDate when both present", () => {
    expect(
      derivePublishedAt({ dateAdded: "2026-07-01", pubDate: "Tue, 07 Jul 2026 10:00:00 GMT" }, NOW)
    ).toBe("2026-07-01T00:00:00.000Z");
  });

  it("no known key → null (ingestion-time fallback)", () => {
    expect(derivePublishedAt({ title: "MITRE technique" }, NOW)).toBeNull();
  });

  it("unparseable date string → null, does not throw", () => {
    expect(derivePublishedAt({ dateAdded: "not-a-date" }, NOW)).toBeNull();
  });

  it("empty/whitespace value → null; falls through to the next key", () => {
    expect(derivePublishedAt({ dateAdded: "  ", published: "2026-07-02" }, NOW)).toBe(
      "2026-07-02T00:00:00.000Z"
    );
  });

  it("bounds guard: pre-1990 dates → null (garbage guard)", () => {
    expect(derivePublishedAt({ dateAdded: "1899-01-01" }, NOW)).toBeNull();
  });

  it("bounds guard: more than 1 day in the future → null", () => {
    expect(derivePublishedAt({ dateAdded: "2026-07-15" }, NOW)).toBeNull();
  });

  it("an ANCIENT but real date (2008 KEV entry) is PRESERVED — suppression is read-time", () => {
    expect(derivePublishedAt({ dateAdded: "2008-10-23" }, NOW)).toBe("2008-10-23T00:00:00.000Z");
  });

  it("non-string values are skipped", () => {
    expect(derivePublishedAt({ dateAdded: 20260701, published: "2026-07-02" } as Record<string, unknown>, NOW)).toBe(
      "2026-07-02T00:00:00.000Z"
    );
  });
});

describe("normalizeSignal — published_at threading (IQP Q2)", () => {
  function input(payload: Record<string, unknown>): CyberSignalIngestInput {
    return {
      source: "cisa_kev",
      signal_type: "cve",
      severity: "High",
      raw_payload: payload,
      normalized_summary: "s",
      affected_vendor: "Microsoft",
      affected_cve: "CVE-2008-4250",
      external_id: null
    };
  }

  it("KEV entry carries its dateAdded as published_at", () => {
    const out = normalizeSignal(input({ dateAdded: "2008-10-23" }), NOW, false);
    expect(out.published_at).toBe("2008-10-23T00:00:00.000Z");
  });

  it("payload without a date key → published_at null", () => {
    const out = normalizeSignal(input({ vulnerabilityName: "x" }), NOW, false);
    expect(out.published_at).toBeNull();
  });

  it("published_at does not participate in dedup_hash (hash unchanged either way)", () => {
    const a = normalizeSignal(input({ dateAdded: "2008-10-23" }), NOW, false);
    const b = normalizeSignal(input({ vulnerabilityName: "x" }), NOW, false);
    expect(a.dedup_hash).toBe(b.dedup_hash);
  });
});

describe("signalRecencyEnabled — dark by default", () => {
  it("OFF for absent env", () => {
    expect(signalRecencyEnabled({} as NodeJS.ProcessEnv)).toBe(false);
  });
  it("ON only for exact 'true'", () => {
    expect(signalRecencyEnabled({ SECURELOGIC_SIGNAL_RECENCY_ENABLED: "true" } as unknown as NodeJS.ProcessEnv)).toBe(true);
    expect(signalRecencyEnabled({ SECURELOGIC_SIGNAL_RECENCY_ENABLED: "1" } as unknown as NodeJS.ProcessEnv)).toBe(false);
  });
});
