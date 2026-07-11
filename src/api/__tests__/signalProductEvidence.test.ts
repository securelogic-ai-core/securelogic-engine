/**
 * C4 / ADR-0003 D1 — product evidence extraction.
 *
 * ERG R2: "vendor identity ALONE is never product-identifiable and must never yield an
 * `affected` determination." The live pipeline only ever persisted affected_vendor — the
 * product name was read by cisaKevAdapter, used in the summary string, and then dropped.
 * It was never actually lost (raw_payload holds the whole feed entry); it was never read.
 *
 * The honest failure mode is SILENCE, not a guess: a source we have not taught, or a feed
 * entry with no product, yields NO evidence — and therefore cannot raise `affected`.
 */
import { describe, it, expect } from "vitest";
import { extractSignalProductEvidence } from "../lib/signalProductEvidence.js";

const KEV_ENTRY = {
  cveID: "CVE-2024-12345",
  vendorProject: "Microsoft",
  product: "Exchange Server",
  vulnerabilityName: "Microsoft Exchange Server RCE",
};

describe("extractSignalProductEvidence", () => {
  it("recovers the product CISA KEV always sent and the pipeline always dropped", () => {
    const ev = extractSignalProductEvidence({
      source: "cisa_kev",
      affected_vendor: "Microsoft",
      affected_cve: "CVE-2024-12345",
      raw_payload: KEV_ENTRY,
    });
    expect(ev).not.toBeNull();
    expect(ev!.product_raw).toBe("Exchange Server");
    expect(ev!.vendor_raw).toBe("Microsoft");
  });

  it("carries an explainability trail — ERG R2 requires an EXPLAINABLE match", () => {
    const ev = extractSignalProductEvidence({
      source: "cisa_kev",
      affected_vendor: "Microsoft",
      affected_cve: "CVE-2024-12345",
      raw_payload: KEV_ENTRY,
    });
    expect(ev!.evidence_ref).toBe("cisa_kev:product");
  });

  it("NEVER falls back to the vendor name when the feed named no product (R2)", () => {
    // The single most important case. A vendor is not a product. Returning
    // {product: "Microsoft"} here is exactly the inference R2 forbids — and exactly what
    // the shadow runner had to fake to produce candidates at all.
    const ev = extractSignalProductEvidence({
      source: "cisa_kev",
      affected_vendor: "Microsoft",
      affected_cve: "CVE-2024-12345",
      raw_payload: { ...KEV_ENTRY, product: "" },
    });
    expect(ev).toBeNull();
  });

  it("stays silent for a source it has not been taught — no guessing from arbitrary payloads", () => {
    const ev = extractSignalProductEvidence({
      source: "some_new_feed",
      affected_vendor: "Microsoft",
      affected_cve: "CVE-2024-12345",
      // Even though a 'product' key is sitting right there.
      raw_payload: { product: "Exchange Server" },
    });
    expect(ev).toBeNull();
  });

  it("stays silent when there is no payload at all", () => {
    expect(
      extractSignalProductEvidence({
        source: "cisa_kev",
        affected_vendor: "Microsoft",
        affected_cve: "CVE-2024-12345",
        raw_payload: null,
      })
    ).toBeNull();
  });

  it("ignores a non-string product rather than coercing it", () => {
    const ev = extractSignalProductEvidence({
      source: "cisa_kev",
      affected_vendor: "Microsoft",
      affected_cve: "CVE-2024-12345",
      raw_payload: { ...KEV_ENTRY, product: 42 },
    });
    expect(ev).toBeNull();
  });
});
