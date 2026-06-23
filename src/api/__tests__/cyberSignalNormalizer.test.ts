/**
 * cyberSignalNormalizer.test.ts — dedup-hash collapse fix.
 *
 * Hard regression contract:
 *   - Sources that set affected_cve (CISA KEV, NVD) pass NO external_id and MUST
 *     produce the BYTE-IDENTICAL legacy hash source|signal_type|cve|vendor. The
 *     golden values below are pinned so a future edit to buildDedupHash that
 *     drifts the legacy branch fails loudly (and would mean a one-time prod
 *     re-ingestion of every KEV/NVD row).
 *   - Vendorless / CVE-less sources (regulatory feeds, news with no CVE/vendor)
 *     pass an external_id and MUST dedup per-item instead of collapsing.
 *
 * Pure — no I/O.
 */

import { describe, it, expect } from "vitest";
import { createHash } from "crypto";
import {
  buildDedupHash,
  normalizeSignal
} from "../lib/cyberSignalNormalizer.js";
import type { CyberSignalIngestInput } from "../lib/cyberSignalValidation.js";

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

// Golden values computed from the LEGACY key string. If buildDedupHash ever
// changes these for the no-external_id path, that is a regression.
const KEV_GOLDEN = sha("cisa_kev|cve|cve-2024-12345|microsoft");
const NVD_GOLDEN = sha("nvd|cve|cve-2024-99999|");

describe("buildDedupHash — legacy branch (zero-regression guarantee)", () => {
  it("KEV signal hashes byte-identically to the legacy source|type|cve|vendor key", () => {
    expect(buildDedupHash("cisa_kev", "cve", "CVE-2024-12345", "microsoft")).toBe(KEV_GOLDEN);
  });

  it("NVD signal (no vendor) hashes byte-identically to the legacy key", () => {
    expect(buildDedupHash("nvd", "cve", "CVE-2024-99999", null)).toBe(NVD_GOLDEN);
  });

  it("passing externalId null or undefined is identical to omitting it (legacy path)", () => {
    const omitted = buildDedupHash("cisa_kev", "cve", "CVE-2024-12345", "microsoft");
    const explicitNull = buildDedupHash("cisa_kev", "cve", "CVE-2024-12345", "microsoft", null);
    const emptyString = buildDedupHash("cisa_kev", "cve", "CVE-2024-12345", "microsoft", "   ");
    expect(explicitNull).toBe(omitted);
    expect(emptyString).toBe(omitted); // whitespace-only id ⇒ treated as absent
    expect(omitted).toBe(KEV_GOLDEN);
  });
});

describe("buildDedupHash — external_id branch (collapse fix)", () => {
  it("two distinct regulatory items (same source/type, no cve/vendor) get DISTINCT hashes", () => {
    const a = buildDedupHash("nist_news", "regulatory_change", null, null, "guid-1");
    const b = buildDedupHash("nist_news", "regulatory_change", null, null, "guid-2");
    expect(a).not.toBe(b);
    expect(a).toBe(sha("nist_news|regulatory_change|id:guid-1"));
    expect(b).toBe(sha("nist_news|regulatory_change|id:guid-2"));
  });

  it("the SAME regulatory item (same external_id) still collapses to one hash", () => {
    const first = buildDedupHash("nist_news", "regulatory_change", null, null, "guid-1");
    const repeat = buildDedupHash("nist_news", "regulatory_change", null, null, "guid-1");
    expect(repeat).toBe(first);
  });

  it("WITHOUT the fix these two items would have collided (proof of the original bug)", () => {
    const legacyA = buildDedupHash("nist_news", "regulatory_change", null, null);
    const legacyB = buildDedupHash("nist_news", "regulatory_change", null, null);
    expect(legacyA).toBe(legacyB); // the collapse the fix removes
  });

  it("external_id takes precedence over cve/vendor when present", () => {
    const withId = buildDedupHash("x", "y", "CVE-2024-1", "vendorco", "ext-1");
    expect(withId).toBe(sha("x|y|id:ext-1"));
    expect(withId).not.toBe(buildDedupHash("x", "y", "CVE-2024-1", "vendorco"));
  });

  it("external_id is lowercased/trimmed for the hash (case-insensitive dedup)", () => {
    expect(buildDedupHash("s", "t", null, null, "  GUID-ABC  ")).toBe(
      buildDedupHash("s", "t", null, null, "guid-abc")
    );
  });
});

describe("normalizeSignal — threads external_id end to end", () => {
  const base: Omit<CyberSignalIngestInput, "external_id"> = {
    source: "nist_news",
    signal_type: "regulatory_change",
    severity: "Moderate",
    raw_payload: { title: "NIST updates privacy framework" },
    normalized_summary: "NIST updates privacy framework",
    affected_vendor: null,
    affected_cve: null
  };

  it("regulatory signal with external_id → id-based hash + passthrough column", () => {
    const out = normalizeSignal({ ...base, external_id: "guid-1" });
    expect(out.external_id).toBe("guid-1");
    expect(out.dedup_hash).toBe(sha("nist_news|regulatory_change|id:guid-1"));
  });

  it("KEV-style signal with NO external_id → legacy hash + null column (unchanged)", () => {
    const out = normalizeSignal({
      source: "cisa_kev",
      signal_type: "cve",
      severity: "High",
      raw_payload: { vulnerabilityName: "Example" },
      normalized_summary: "Example",
      affected_vendor: "microsoft",
      affected_cve: "CVE-2024-12345"
    });
    expect(out.external_id).toBeNull();
    expect(out.dedup_hash).toBe(KEV_GOLDEN);
  });

  it("empty/whitespace external_id normalizes to null and uses the legacy hash", () => {
    const out = normalizeSignal({ ...base, external_id: "   " });
    expect(out.external_id).toBeNull();
    expect(out.dedup_hash).toBe(sha("nist_news|regulatory_change||"));
  });
});
