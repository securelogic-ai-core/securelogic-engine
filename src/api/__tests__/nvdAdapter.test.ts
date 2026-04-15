import { describe, it, expect } from "vitest";

import {
  parseCpeVendor,
  extractNvdEnDescription,
  extractNvdSeverity,
  extractNvdVendor,
  buildNvdNormalizedSummary,
  mapNvdCveToSignal,
  type NvdCve,
  type NvdVulnerability
} from "../lib/nvdAdapter.js";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeVuln(cve: NvdCve): NvdVulnerability {
  return { cve };
}

function makeMetricV31(baseScore: number, type = "Primary") {
  return {
    source: "nvd@nist.gov",
    type,
    cvssData: {
      version: "3.1",
      vectorString: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
      baseScore,
      baseSeverity: baseScore >= 9 ? "CRITICAL" : "HIGH"
    }
  };
}

function makeMetricV2(baseScore: number, type = "Primary") {
  return {
    source: "nvd@nist.gov",
    type,
    cvssData: { version: "2.0", baseScore }
  };
}

function makeCpeMatch(criteria: string, vulnerable = true) {
  return { vulnerable, criteria, matchCriteriaId: "dummy" };
}

function makeConfig(criteria: string, vulnerable = true) {
  return {
    nodes: [{
      operator: "OR",
      negate: false,
      cpeMatch: [makeCpeMatch(criteria, vulnerable)]
    }]
  };
}

// ---------------------------------------------------------------------------
// Real-world fixture CVEs
// ---------------------------------------------------------------------------

/** CVE-2021-44228 — Log4Shell (CVSS 10.0 Critical, Apache) */
const cveLog4Shell: NvdCve = {
  id: "CVE-2021-44228",
  published: "2021-12-10T10:15:00.000",
  lastModified: "2023-02-24T00:00:00.000",
  vulnStatus: "Analyzed",
  descriptions: [
    {
      lang: "en",
      value:
        "Apache Log4j2 2.0-beta9 through 2.15.0 (excluding security releases 2.12.2, 2.12.3, and 2.3.1) " +
        "JNDI features used in configuration, log messages, and parameters do not protect against " +
        "attacker controlled LDAP and other JNDI related endpoints."
    }
  ],
  metrics: {
    cvssMetricV31: [makeMetricV31(10.0)]
  },
  configurations: [makeConfig("cpe:2.3:a:apache:log4j:*:*:*:*:*:*:*:*")]
};

/** CVE-2023-44487 — HTTP/2 Rapid Reset (CVSS 7.5 High, multiple vendors) */
const cveHttp2RapidReset: NvdCve = {
  id: "CVE-2023-44487",
  published: "2023-10-10T14:15:00.000",
  lastModified: "2023-11-01T00:00:00.000",
  vulnStatus: "Analyzed",
  descriptions: [
    {
      lang: "en",
      value:
        "The HTTP/2 protocol allows a denial of service (server resource consumption) because request " +
        "cancellation can reset many streams quickly, as exploited in the wild in August through October 2023."
    }
  ],
  metrics: {
    cvssMetricV31: [makeMetricV31(7.5)]
  },
  configurations: [makeConfig("cpe:2.3:a:ietf:http:2.0:*:*:*:*:*:*:*")]
};

/** CVE-2023-3094 — XZ Utils backdoor (CVSS 10.0 Critical, no vendor in config) */
const cveXzUtils: NvdCve = {
  id: "CVE-2024-3094",
  published: "2024-03-29T17:15:00.000",
  lastModified: "2024-04-01T00:00:00.000",
  vulnStatus: "Awaiting Analysis",
  descriptions: [
    {
      lang: "en",
      value:
        "Malicious code was discovered in the upstream tarballs of xz, starting with version 5.6.0. " +
        "The malicious code appears to be present only in the 5.6.0 and 5.6.1 tarballs."
    }
  ],
  metrics: {
    cvssMetricV31: [makeMetricV31(10.0)]
  },
  configurations: [makeConfig("cpe:2.3:a:tukaani:xz:5.6.0:*:*:*:*:*:*:*")]
};

/** CVE-2023-99999 — No CVSS, no configurations (tests defaults) */
const cveNoCvss: NvdCve = {
  id: "CVE-2023-99999",
  published: "2023-12-01T00:00:00.000",
  lastModified: "2023-12-01T00:00:00.000",
  vulnStatus: "Awaiting Analysis",
  descriptions: [
    {
      lang: "en",
      value: "A newly published vulnerability with no scoring data yet."
    }
  ],
  metrics: {},
  configurations: []
};

/** CVE-2019-0708 — BlueKeep (only CVSS v2 score) */
const cveBlueKeep: NvdCve = {
  id: "CVE-2019-0708",
  published: "2019-05-16T19:29:00.000",
  lastModified: "2019-06-11T00:00:00.000",
  vulnStatus: "Analyzed",
  descriptions: [
    {
      lang: "en",
      value:
        "A remote code execution vulnerability exists in Remote Desktop Services formerly known as " +
        "Terminal Services when an unauthenticated attacker connects to the target system using RDP."
    }
  ],
  metrics: {
    cvssMetricV2: [makeMetricV2(9.3)]
  },
  configurations: [makeConfig("cpe:2.3:o:microsoft:windows_7:-:*:*:*:*:*:*:*")]
};

// ====================================================================
// parseCpeVendor
// ====================================================================

describe("parseCpeVendor — standard CPE 2.3 strings", () => {
  it("extracts 'apache' from Apache log4j CPE", () => {
    expect(parseCpeVendor("cpe:2.3:a:apache:log4j:*:*:*:*:*:*:*:*")).toBe("apache");
  });

  it("extracts 'microsoft' from Microsoft Windows CPE", () => {
    expect(parseCpeVendor("cpe:2.3:o:microsoft:windows_7:-:*:*:*:*:*:*:*")).toBe("microsoft");
  });

  it("extracts 'cisco' from Cisco IOS CPE", () => {
    expect(parseCpeVendor("cpe:2.3:o:cisco:ios_xe:17.3.1:*:*:*:*:*:*:*")).toBe("cisco");
  });

  it("converts underscores to spaces in vendor", () => {
    expect(parseCpeVendor("cpe:2.3:a:palo_alto_networks:pan-os:*:*:*:*:*:*:*:*")).toBe(
      "palo alto networks"
    );
  });

  it("extracts 'tukaani' from XZ utils CPE", () => {
    expect(parseCpeVendor("cpe:2.3:a:tukaani:xz:5.6.0:*:*:*:*:*:*:*")).toBe("tukaani");
  });
});

describe("parseCpeVendor — edge cases", () => {
  it("returns null for wildcard vendor '*'", () => {
    expect(parseCpeVendor("cpe:2.3:a:*:product:version:*:*:*:*:*:*:*")).toBeNull();
  });

  it("returns null for N/A vendor '-'", () => {
    expect(parseCpeVendor("cpe:2.3:a:-:product:version:*:*:*:*:*:*:*")).toBeNull();
  });

  it("returns null for non-CPE string", () => {
    expect(parseCpeVendor("not-a-cpe-string")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseCpeVendor("")).toBeNull();
  });

  it("returns null for too-short CPE", () => {
    expect(parseCpeVendor("cpe:2.3:a:vendor")).toBeNull();
  });

  it("returns null for non-string input", () => {
    expect(parseCpeVendor(null as unknown as string)).toBeNull();
  });
});

// ====================================================================
// extractNvdEnDescription
// ====================================================================

describe("extractNvdEnDescription — standard entries", () => {
  it("returns the English description for Log4Shell", () => {
    const desc = extractNvdEnDescription(cveLog4Shell);
    expect(desc).toContain("Apache Log4j2");
    expect(desc).toContain("JNDI");
  });

  it("returns the English description for BlueKeep", () => {
    const desc = extractNvdEnDescription(cveBlueKeep);
    expect(desc).toContain("Remote Desktop Services");
  });

  it("returns null when descriptions array is empty", () => {
    const cve: NvdCve = {
      id: "CVE-2023-1111",
      published: "",
      lastModified: "",
      descriptions: []
    };
    expect(extractNvdEnDescription(cve)).toBeNull();
  });

  it("returns null when only non-English descriptions exist", () => {
    const cve: NvdCve = {
      id: "CVE-2023-2222",
      published: "",
      lastModified: "",
      descriptions: [{ lang: "es", value: "Descripción en español." }]
    };
    expect(extractNvdEnDescription(cve)).toBeNull();
  });

  it("returns null when English description value is empty", () => {
    const cve: NvdCve = {
      id: "CVE-2023-3333",
      published: "",
      lastModified: "",
      descriptions: [{ lang: "en", value: "   " }]
    };
    expect(extractNvdEnDescription(cve)).toBeNull();
  });
});

// ====================================================================
// extractNvdSeverity
// ====================================================================

describe("extractNvdSeverity — CVSS v3.1 scores", () => {
  it("Log4Shell CVSS 10.0 → Critical", () => {
    expect(extractNvdSeverity(cveLog4Shell)).toBe("Critical");
  });

  it("HTTP/2 Rapid Reset CVSS 7.5 → High", () => {
    expect(extractNvdSeverity(cveHttp2RapidReset)).toBe("High");
  });

  it("CVSS 9.0 → Critical", () => {
    const cve: NvdCve = {
      id: "CVE-2023-0001",
      published: "",
      lastModified: "",
      descriptions: [],
      metrics: { cvssMetricV31: [makeMetricV31(9.0)] }
    };
    expect(extractNvdSeverity(cve)).toBe("Critical");
  });

  it("CVSS 6.9 → Moderate", () => {
    const cve: NvdCve = {
      id: "CVE-2023-0002",
      published: "",
      lastModified: "",
      descriptions: [],
      metrics: { cvssMetricV31: [makeMetricV31(6.9)] }
    };
    expect(extractNvdSeverity(cve)).toBe("Moderate");
  });

  it("CVSS 3.5 → Low", () => {
    const cve: NvdCve = {
      id: "CVE-2023-0003",
      published: "",
      lastModified: "",
      descriptions: [],
      metrics: { cvssMetricV31: [makeMetricV31(3.5)] }
    };
    expect(extractNvdSeverity(cve)).toBe("Low");
  });
});

describe("extractNvdSeverity — CVSS v2 fallback", () => {
  it("BlueKeep CVSS v2 9.3 → Critical", () => {
    expect(extractNvdSeverity(cveBlueKeep)).toBe("Critical");
  });

  it("falls back to v2 when v3.1 is absent", () => {
    const cve: NvdCve = {
      id: "CVE-2023-0004",
      published: "",
      lastModified: "",
      descriptions: [],
      metrics: { cvssMetricV2: [makeMetricV2(7.5)] }
    };
    expect(extractNvdSeverity(cve)).toBe("High");
  });
});

describe("extractNvdSeverity — defaults", () => {
  it("no metrics → Moderate", () => {
    expect(extractNvdSeverity(cveNoCvss)).toBe("Moderate");
  });

  it("empty metrics object → Moderate", () => {
    const cve: NvdCve = {
      id: "CVE-2023-0005",
      published: "",
      lastModified: "",
      descriptions: [],
      metrics: {}
    };
    expect(extractNvdSeverity(cve)).toBe("Moderate");
  });

  it("metrics undefined → Moderate", () => {
    const cve: NvdCve = {
      id: "CVE-2023-0006",
      published: "",
      lastModified: "",
      descriptions: []
    };
    expect(extractNvdSeverity(cve)).toBe("Moderate");
  });

  it("Primary metric preferred over non-Primary", () => {
    const cve: NvdCve = {
      id: "CVE-2023-0007",
      published: "",
      lastModified: "",
      descriptions: [],
      metrics: {
        cvssMetricV31: [
          { source: "other", type: "Secondary", cvssData: { version: "3.1", baseScore: 4.0, baseSeverity: "MEDIUM" } },
          { source: "nvd@nist.gov", type: "Primary", cvssData: { version: "3.1", baseScore: 9.8, baseSeverity: "CRITICAL" } }
        ]
      }
    };
    expect(extractNvdSeverity(cve)).toBe("Critical");
  });
});

describe("extractNvdSeverity — v3.1 preferred over v2", () => {
  it("uses v3.1 even when v2 is also present", () => {
    const cve: NvdCve = {
      id: "CVE-2023-0008",
      published: "",
      lastModified: "",
      descriptions: [],
      metrics: {
        cvssMetricV31: [makeMetricV31(7.5)],
        cvssMetricV2: [makeMetricV2(9.0)]
      }
    };
    // v3.1 score is 7.5 (High), v2 is 9.0 (Critical) — v3.1 wins
    expect(extractNvdSeverity(cve)).toBe("High");
  });
});

// ====================================================================
// extractNvdVendor
// ====================================================================

describe("extractNvdVendor — standard entries", () => {
  it("extracts 'apache' from Log4Shell configurations", () => {
    expect(extractNvdVendor(cveLog4Shell)).toBe("apache");
  });

  it("extracts 'microsoft' from BlueKeep configurations", () => {
    expect(extractNvdVendor(cveBlueKeep)).toBe("microsoft");
  });

  it("extracts 'ietf' from HTTP/2 Rapid Reset configurations", () => {
    expect(extractNvdVendor(cveHttp2RapidReset)).toBe("ietf");
  });

  it("extracts 'tukaani' from XZ Utils configurations", () => {
    expect(extractNvdVendor(cveXzUtils)).toBe("tukaani");
  });
});

describe("extractNvdVendor — absent configurations", () => {
  it("returns null when configurations array is empty", () => {
    expect(extractNvdVendor(cveNoCvss)).toBeNull();
  });

  it("returns null when configurations is undefined", () => {
    const cve: NvdCve = {
      id: "CVE-2023-9001",
      published: "",
      lastModified: "",
      descriptions: []
    };
    expect(extractNvdVendor(cve)).toBeNull();
  });

  it("returns null when no cpeMatch entries are vulnerable", () => {
    const cve: NvdCve = {
      id: "CVE-2023-9002",
      published: "",
      lastModified: "",
      descriptions: [],
      configurations: [{
        nodes: [{
          operator: "OR",
          negate: false,
          cpeMatch: [makeCpeMatch("cpe:2.3:a:vendor:product:*:*:*:*:*:*:*:*", false)]
        }]
      }]
    };
    expect(extractNvdVendor(cve)).toBeNull();
  });
});

// ====================================================================
// buildNvdNormalizedSummary
// ====================================================================

describe("buildNvdNormalizedSummary", () => {
  it("returns English description for Log4Shell", () => {
    const summary = buildNvdNormalizedSummary(cveLog4Shell);
    expect(summary).not.toBeNull();
    expect(summary!).toContain("Apache Log4j2");
  });

  it("returns null when no English description exists", () => {
    const cve: NvdCve = {
      id: "CVE-2023-0009",
      published: "",
      lastModified: "",
      descriptions: [{ lang: "es", value: "Solo español." }]
    };
    expect(buildNvdNormalizedSummary(cve)).toBeNull();
  });

  it("truncates long descriptions to 500 chars", () => {
    const cve: NvdCve = {
      id: "CVE-2023-0010",
      published: "",
      lastModified: "",
      descriptions: [{ lang: "en", value: "X".repeat(600) }]
    };
    const summary = buildNvdNormalizedSummary(cve);
    expect(summary!.length).toBe(500);
    expect(summary!.endsWith("...")).toBe(true);
  });

  it("does not truncate descriptions exactly 500 chars", () => {
    const cve: NvdCve = {
      id: "CVE-2023-0011",
      published: "",
      lastModified: "",
      descriptions: [{ lang: "en", value: "A".repeat(500) }]
    };
    const summary = buildNvdNormalizedSummary(cve);
    expect(summary!.length).toBe(500);
    expect(summary!.endsWith("...")).toBe(false);
  });
});

// ====================================================================
// mapNvdCveToSignal — field mapping
// ====================================================================

describe("mapNvdCveToSignal — Log4Shell (Critical, Apache, has description)", () => {
  const result = mapNvdCveToSignal(makeVuln(cveLog4Shell));

  it("returns non-null", () => {
    expect(result).not.toBeNull();
  });

  it("source is 'nvd'", () => {
    expect(result!.source).toBe("nvd");
  });

  it("signal_type is 'cve'", () => {
    expect(result!.signal_type).toBe("cve");
  });

  it("severity is Critical (CVSS 10.0)", () => {
    expect(result!.severity).toBe("Critical");
  });

  it("affected_cve is CVE-2021-44228", () => {
    expect(result!.affected_cve).toBe("CVE-2021-44228");
  });

  it("affected_vendor is 'apache'", () => {
    expect(result!.affected_vendor).toBe("apache");
  });

  it("normalized_summary contains Apache Log4j2", () => {
    expect(result!.normalized_summary).toContain("Apache Log4j2");
  });

  it("raw_payload contains the CVE id", () => {
    expect((result!.raw_payload as any).id).toBe("CVE-2021-44228");
  });
});

describe("mapNvdCveToSignal — HTTP/2 Rapid Reset (High, IETF)", () => {
  const result = mapNvdCveToSignal(makeVuln(cveHttp2RapidReset));

  it("returns non-null", () => {
    expect(result).not.toBeNull();
  });

  it("severity is High (CVSS 7.5)", () => {
    expect(result!.severity).toBe("High");
  });

  it("affected_cve is CVE-2023-44487", () => {
    expect(result!.affected_cve).toBe("CVE-2023-44487");
  });
});

describe("mapNvdCveToSignal — BlueKeep (CVSS v2 only → Critical)", () => {
  const result = mapNvdCveToSignal(makeVuln(cveBlueKeep));

  it("returns non-null", () => {
    expect(result).not.toBeNull();
  });

  it("severity is Critical (CVSS v2 9.3)", () => {
    expect(result!.severity).toBe("Critical");
  });

  it("affected_vendor is 'microsoft'", () => {
    expect(result!.affected_vendor).toBe("microsoft");
  });
});

describe("mapNvdCveToSignal — no CVSS no configs → Moderate, null vendor", () => {
  const result = mapNvdCveToSignal(makeVuln(cveNoCvss));

  it("returns non-null", () => {
    expect(result).not.toBeNull();
  });

  it("severity defaults to Moderate", () => {
    expect(result!.severity).toBe("Moderate");
  });

  it("affected_vendor is null", () => {
    expect(result!.affected_vendor).toBeNull();
  });

  it("affected_cve is CVE-2023-99999", () => {
    expect(result!.affected_cve).toBe("CVE-2023-99999");
  });
});

// ====================================================================
// mapNvdCveToSignal — invalid / edge cases
// ====================================================================

describe("mapNvdCveToSignal — invalid entries", () => {
  it("returns null when CVE id is empty", () => {
    const cve = { ...cveLog4Shell, id: "" };
    expect(mapNvdCveToSignal(makeVuln(cve))).toBeNull();
  });

  it("returns null when CVE id is not CVE format", () => {
    const cve = { ...cveLog4Shell, id: "GHSA-jfh8-c2jp-hdp1" };
    expect(mapNvdCveToSignal(makeVuln(cve))).toBeNull();
  });

  it("returns null for null vulnerability input", () => {
    expect(mapNvdCveToSignal(null as unknown as NvdVulnerability)).toBeNull();
  });

  it("returns null when cve field is missing", () => {
    expect(mapNvdCveToSignal({} as NvdVulnerability)).toBeNull();
  });
});

describe("mapNvdCveToSignal — CVE ID normalization", () => {
  it("normalizes lowercase CVE ID to uppercase", () => {
    const cve = { ...cveLog4Shell, id: "cve-2021-44228" };
    const result = mapNvdCveToSignal(makeVuln(cve));
    expect(result).not.toBeNull();
    expect(result!.affected_cve).toBe("CVE-2021-44228");
  });
});

// ====================================================================
// mapNvdCveToSignal — output shape
// ====================================================================

describe("mapNvdCveToSignal — output shape", () => {
  it("output has exactly 7 keys", () => {
    const result = mapNvdCveToSignal(makeVuln(cveLog4Shell));
    expect(result).not.toBeNull();
    const keys = Object.keys(result!).sort();
    expect(keys).toEqual(
      [
        "affected_cve",
        "affected_vendor",
        "normalized_summary",
        "raw_payload",
        "severity",
        "signal_type",
        "source"
      ].sort()
    );
  });
});
