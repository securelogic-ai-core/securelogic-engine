import { describe, it, expect } from "vitest";

import {
  parseEdgarCompanyName,
  buildEdgarFilingUrl,
  hitHasCyberIncidentItem,
  mapEdgarHitToSignal,
  type EdgarHit
} from "../lib/secEdgarAdapter.js";
import { normalizeSignal } from "../lib/cyberSignalNormalizer.js";

// ---------------------------------------------------------------------------
// Real captured EFTS records (live efts.sec.gov pull). DATA I/O CORP filed TWO
// Item-1.05 8-Ks in 2025 — the real same-filer case the dedup fix must keep
// distinct.
// ---------------------------------------------------------------------------

const DATA_IO_SEP: EdgarHit = {
  _id: "0001654954-25-010613:daio_8k.htm",
  _source: {
    ciks: ["0000351998"],
    display_names: ["DATA I/O CORP  (DAIO)  (CIK 0000351998)"],
    file_date: "2025-09-10",
    form: "8-K",
    adsh: "0001654954-25-010613",
    items: ["1.05", "7.01", "9.01"]
  }
};

const DATA_IO_AUG: EdgarHit = {
  _id: "0001654954-25-009925:daio_8k.htm",
  _source: {
    ciks: ["0000351998"],
    display_names: ["DATA I/O CORP  (DAIO)  (CIK 0000351998)"],
    file_date: "2025-08-21",
    form: "8-K",
    adsh: "0001654954-25-009925",
    items: ["1.05"]
  }
};

const SENSATA: EdgarHit = {
  _id: "0001477294-25-000047:st-20250406.htm",
  _source: {
    ciks: ["0001477294"],
    display_names: ["Sensata Technologies Holding plc  (ST)  (CIK 0001477294)"],
    file_date: "2025-04-09",
    form: "8-K",
    adsh: "0001477294-25-000047",
    items: ["1.05"]
  }
};

// A hit that matches the q phrase but is NOT an Item 1.05 disclosure.
const NON_105: EdgarHit = {
  _id: "0000000000-25-000001:x.htm",
  _source: {
    ciks: ["0000000000"],
    display_names: ["EXAMPLE CO  (EX)  (CIK 0000000000)"],
    file_date: "2025-01-01",
    form: "8-K",
    adsh: "0000000000-25-000001",
    items: ["8.01"]
  }
};

// ---------------------------------------------------------------------------
// parseEdgarCompanyName
// ---------------------------------------------------------------------------

describe("parseEdgarCompanyName", () => {
  it("strips the (TICKER) (CIK …) annotation from a display name", () => {
    expect(parseEdgarCompanyName("DATA I/O CORP  (DAIO)  (CIK 0000351998)")).toBe("DATA I/O CORP");
    expect(parseEdgarCompanyName("NUCOR CORP  (NUE)  (CIK 0000073309)")).toBe("NUCOR CORP");
  });

  it("keeps multi-word legal names intact (no over-trimming)", () => {
    expect(parseEdgarCompanyName("Sensata Technologies Holding plc  (ST)  (CIK 0001477294)"))
      .toBe("Sensata Technologies Holding plc");
  });

  it("handles a display name with only a CIK (no ticker)", () => {
    expect(parseEdgarCompanyName("PRIVATE FILER LLC  (CIK 0001234567)")).toBe("PRIVATE FILER LLC");
  });

  it("returns empty string for non-string input", () => {
    expect(parseEdgarCompanyName(undefined as unknown as string)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// buildEdgarFilingUrl
// ---------------------------------------------------------------------------

describe("buildEdgarFilingUrl", () => {
  it("constructs the SEC Archives URL (CIK leading zeros stripped, dashes removed)", () => {
    expect(buildEdgarFilingUrl("0000351998", "0001654954-25-010613", "daio_8k.htm")).toBe(
      "https://www.sec.gov/Archives/edgar/data/351998/000165495425010613/daio_8k.htm"
    );
  });

  it("returns null when cik or accession is missing", () => {
    expect(buildEdgarFilingUrl(null, "0001654954-25-010613", "x.htm")).toBeNull();
    expect(buildEdgarFilingUrl("0000351998", null, "x.htm")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// hitHasCyberIncidentItem
// ---------------------------------------------------------------------------

describe("hitHasCyberIncidentItem", () => {
  it("is true when items includes 1.05 (even among other items)", () => {
    expect(hitHasCyberIncidentItem(DATA_IO_SEP)).toBe(true);
    expect(hitHasCyberIncidentItem(SENSATA)).toBe(true);
  });

  it("is false when items lacks 1.05 (q-phrase false positive)", () => {
    expect(hitHasCyberIncidentItem(NON_105)).toBe(false);
  });

  it("is false when items is absent", () => {
    expect(hitHasCyberIncidentItem({ _source: { adsh: "x" } })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// mapEdgarHitToSignal
// ---------------------------------------------------------------------------

describe("mapEdgarHitToSignal", () => {
  it("maps a real Item 1.05 hit to the full CyberSignalIngestInput", () => {
    const sig = mapEdgarHitToSignal(DATA_IO_SEP);
    expect(sig).not.toBeNull();
    expect(sig!.source).toBe("sec_edgar");
    expect(sig!.signal_type).toBe("third_party_breach");
    expect(sig!.severity).toBe("High");
    expect(sig!.affected_vendor).toBe("DATA I/O CORP");      // parsed filer name
    expect(sig!.affected_cve).toBeNull();
    expect(sig!.external_id).toBe("0001654954-25-010613");   // accession = dedup discriminator
    expect(sig!.normalized_summary).toBe(
      "DATA I/O CORP disclosed a material cybersecurity incident (8-K Item 1.05), filed 2025-09-10."
    );
    expect(sig!.raw_payload.filing_url).toBe(
      "https://www.sec.gov/Archives/edgar/data/351998/000165495425010613/daio_8k.htm"
    );
    expect(sig!.raw_payload.items).toEqual(["1.05", "7.01", "9.01"]);
  });

  it("filters out a hit that is not an Item 1.05 disclosure", () => {
    expect(mapEdgarHitToSignal(NON_105)).toBeNull();
  });

  it("returns null when the accession is missing", () => {
    expect(mapEdgarHitToSignal({ _source: { display_names: ["X (CIK 1)"], items: ["1.05"] } })).toBeNull();
  });

  // -------------------------------------------------------------------------
  // DEDUP — the real same-filer pair (DATA I/O CORP, two accessions)
  // -------------------------------------------------------------------------
  it("two 8-Ks from the SAME filer produce DISTINCT dedup hashes (accession external_id)", () => {
    const sep = mapEdgarHitToSignal(DATA_IO_SEP)!;
    const aug = mapEdgarHitToSignal(DATA_IO_AUG)!;

    // Same filer → same affected_vendor; the accession external_id distinguishes them.
    expect(sep.affected_vendor).toBe(aug.affected_vendor);
    expect(sep.external_id).not.toBe(aug.external_id);

    const sepHash = normalizeSignal(sep).dedup_hash;
    const augHash = normalizeSignal(aug).dedup_hash;
    expect(sepHash).not.toBe(augHash);                       // both rows persist

    // The same filing re-fetched still dedups to one (idempotent).
    expect(normalizeSignal(mapEdgarHitToSignal(DATA_IO_SEP)!).dedup_hash).toBe(sepHash);
  });
});
