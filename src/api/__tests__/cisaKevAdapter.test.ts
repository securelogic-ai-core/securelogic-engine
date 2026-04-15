import { describe, it, expect } from "vitest";

import {
  deriveSeverityFromCvss,
  buildKevNormalizedSummary,
  mapKevEntryToSignal,
  type CisaKevEntry
} from "../lib/cisaKevAdapter.js";

// ---------------------------------------------------------------------------
// Fixtures — representative CISA KEV entries
// ---------------------------------------------------------------------------

const entryMicrosoftWindows: CisaKevEntry = {
  cveID: "CVE-2024-30080",
  vendorProject: "Microsoft",
  product: "Windows",
  vulnerabilityName: "Microsoft Windows MSMQ Remote Code Execution Vulnerability",
  dateAdded: "2024-06-11",
  shortDescription:
    "Microsoft Windows Message Queuing (MSMQ) contains an unspecified vulnerability allowing remote code execution.",
  requiredAction: "Apply mitigations per vendor instructions or discontinue use of the product.",
  dueDate: "2024-07-02",
  notes: ""
};

const entryApacheLog4j: CisaKevEntry = {
  cveID: "CVE-2021-44228",
  vendorProject: "Apache",
  product: "Log4j2",
  vulnerabilityName: "Apache Log4j2 Remote Code Execution Vulnerability",
  dateAdded: "2021-12-10",
  shortDescription:
    "Apache Log4j2 contains a vulnerability where JNDI features used in configuration, log messages, and parameters do not protect against attacker-controlled LDAP and other JNDI related endpoints.",
  requiredAction: "Apply updates per vendor instructions.",
  dueDate: "2021-12-24",
  cvssScore: 10.0
};

const entryCiscoIOS: CisaKevEntry = {
  cveID: "CVE-2023-20198",
  vendorProject: "Cisco",
  product: "IOS XE",
  vulnerabilityName: "Cisco IOS XE Web UI Privilege Escalation Vulnerability",
  dateAdded: "2023-10-16",
  shortDescription:
    "Cisco IOS XE Software Web UI feature contains a privilege escalation vulnerability that allows a remote, unauthenticated attacker to create an account on an affected system with privilege level 15 access.",
  requiredAction: "Apply mitigations per vendor instructions.",
  dueDate: "2023-10-20",
  cvssScore: 10.0
};

const entryProgressMOVEit: CisaKevEntry = {
  cveID: "CVE-2023-34362",
  vendorProject: "Progress",
  product: "MOVEit Transfer",
  vulnerabilityName: "Progress MOVEit Transfer SQL Injection Vulnerability",
  dateAdded: "2023-06-02",
  shortDescription:
    "Progress MOVEit Transfer contains a SQL injection vulnerability that could allow an unauthenticated attacker to gain unauthorized access.",
  requiredAction: "Apply updates per vendor instructions.",
  dueDate: "2023-06-23",
  cvssScore: 9.8
};

const entryGitLab: CisaKevEntry = {
  cveID: "CVE-2023-7028",
  vendorProject: "GitLab",
  product: "GitLab",
  vulnerabilityName: "GitLab Community and Enterprise Editions Improper Access Control Vulnerability",
  dateAdded: "2024-01-12",
  shortDescription:
    "GitLab Community and Enterprise Editions contain an improper access control vulnerability that allows password reset emails to be sent to unverified email addresses.",
  requiredAction: "Apply mitigations per vendor instructions.",
  dueDate: "2024-01-26",
  cvssScore: 7.5
};

// ====================================================================
// deriveSeverityFromCvss
// ====================================================================

describe("deriveSeverityFromCvss — numeric input", () => {
  it("10.0 → Critical", () => {
    expect(deriveSeverityFromCvss(10.0)).toBe("Critical");
  });

  it("9.0 → Critical", () => {
    expect(deriveSeverityFromCvss(9.0)).toBe("Critical");
  });

  it("9.8 → Critical", () => {
    expect(deriveSeverityFromCvss(9.8)).toBe("Critical");
  });

  it("8.9 → High", () => {
    expect(deriveSeverityFromCvss(8.9)).toBe("High");
  });

  it("7.0 → High", () => {
    expect(deriveSeverityFromCvss(7.0)).toBe("High");
  });

  it("7.5 → High", () => {
    expect(deriveSeverityFromCvss(7.5)).toBe("High");
  });

  it("6.9 → Moderate", () => {
    expect(deriveSeverityFromCvss(6.9)).toBe("Moderate");
  });

  it("4.0 → Moderate", () => {
    expect(deriveSeverityFromCvss(4.0)).toBe("Moderate");
  });

  it("3.9 → Low", () => {
    expect(deriveSeverityFromCvss(3.9)).toBe("Low");
  });

  it("0.0 → Low", () => {
    expect(deriveSeverityFromCvss(0.0)).toBe("Low");
  });
});

describe("deriveSeverityFromCvss — string input", () => {
  it("string '10.0' → Critical", () => {
    expect(deriveSeverityFromCvss("10.0")).toBe("Critical");
  });

  it("string '7.5' → High", () => {
    expect(deriveSeverityFromCvss("7.5")).toBe("High");
  });

  it("string '5.0' → Moderate", () => {
    expect(deriveSeverityFromCvss("5.0")).toBe("Moderate");
  });

  it("string '2.1' → Low", () => {
    expect(deriveSeverityFromCvss("2.1")).toBe("Low");
  });
});

describe("deriveSeverityFromCvss — absent or invalid", () => {
  it("null → null", () => {
    expect(deriveSeverityFromCvss(null)).toBeNull();
  });

  it("undefined → null", () => {
    expect(deriveSeverityFromCvss(undefined)).toBeNull();
  });

  it("non-numeric string → null", () => {
    expect(deriveSeverityFromCvss("N/A")).toBeNull();
  });

  it("NaN → null", () => {
    expect(deriveSeverityFromCvss(NaN)).toBeNull();
  });

  it("score > 10 → null", () => {
    expect(deriveSeverityFromCvss(11)).toBeNull();
  });

  it("score < 0 → null", () => {
    expect(deriveSeverityFromCvss(-1)).toBeNull();
  });
});

// ====================================================================
// buildKevNormalizedSummary
// ====================================================================

describe("buildKevNormalizedSummary — standard entries", () => {
  it("combines vulnerabilityName + vendor + product", () => {
    const summary = buildKevNormalizedSummary(entryMicrosoftWindows);
    expect(summary).toContain("Microsoft Windows MSMQ Remote Code Execution Vulnerability");
    expect(summary).toContain("Microsoft Windows");
  });

  it("uses shortDescription when vulnerabilityName is empty", () => {
    const entry: CisaKevEntry = {
      ...entryMicrosoftWindows,
      vulnerabilityName: ""
    };
    const summary = buildKevNormalizedSummary(entry);
    expect(summary).toContain("Microsoft Windows Message Queuing");
  });

  it("format is '<description> — <vendor> <product>'", () => {
    const summary = buildKevNormalizedSummary(entryApacheLog4j);
    expect(summary).toContain("Apache Log4j2 Remote Code Execution Vulnerability — Apache Log4j2");
  });

  it("omits entity part when both vendor and product are empty", () => {
    const entry: CisaKevEntry = {
      ...entryMicrosoftWindows,
      vendorProject: "",
      product: ""
    };
    const summary = buildKevNormalizedSummary(entry);
    expect(summary).toBe("Microsoft Windows MSMQ Remote Code Execution Vulnerability");
  });

  it("uses only vendor when product is empty", () => {
    const entry: CisaKevEntry = {
      ...entryMicrosoftWindows,
      product: ""
    };
    const summary = buildKevNormalizedSummary(entry);
    expect(summary).toContain("— Microsoft");
    expect(summary).not.toContain("Microsoft Microsoft");
  });

  it("truncates to 500 characters", () => {
    const entry: CisaKevEntry = {
      ...entryMicrosoftWindows,
      vulnerabilityName: "A".repeat(600)
    };
    const summary = buildKevNormalizedSummary(entry);
    expect(summary.length).toBe(500);
    expect(summary.endsWith("...")).toBe(true);
  });
});

// ====================================================================
// mapKevEntryToSignal — field mapping
// ====================================================================

describe("mapKevEntryToSignal — Microsoft Windows entry (no CVSS)", () => {
  const result = mapKevEntryToSignal(entryMicrosoftWindows);

  it("returns non-null", () => {
    expect(result).not.toBeNull();
  });

  it("source is cisa_kev", () => {
    expect(result!.source).toBe("cisa_kev");
  });

  it("signal_type is cve", () => {
    expect(result!.signal_type).toBe("cve");
  });

  it("severity defaults to High when no CVSS", () => {
    expect(result!.severity).toBe("High");
  });

  it("affected_cve is uppercased CVE ID", () => {
    expect(result!.affected_cve).toBe("CVE-2024-30080");
  });

  it("affected_vendor is vendorProject", () => {
    expect(result!.affected_vendor).toBe("Microsoft");
  });

  it("normalized_summary is non-empty", () => {
    expect(result!.normalized_summary).not.toBeNull();
    expect((result!.normalized_summary as string).length).toBeGreaterThan(0);
  });

  it("raw_payload contains the original entry fields", () => {
    expect((result!.raw_payload as any).cveID).toBe("CVE-2024-30080");
    expect((result!.raw_payload as any).vendorProject).toBe("Microsoft");
  });
});

describe("mapKevEntryToSignal — Apache Log4j (CVSS 10.0 → Critical)", () => {
  const result = mapKevEntryToSignal(entryApacheLog4j);

  it("returns non-null", () => {
    expect(result).not.toBeNull();
  });

  it("severity is Critical for CVSS 10.0", () => {
    expect(result!.severity).toBe("Critical");
  });

  it("affected_cve is CVE-2021-44228", () => {
    expect(result!.affected_cve).toBe("CVE-2021-44228");
  });

  it("affected_vendor is Apache", () => {
    expect(result!.affected_vendor).toBe("Apache");
  });
});

describe("mapKevEntryToSignal — Cisco IOS XE (CVSS 10.0 → Critical)", () => {
  const result = mapKevEntryToSignal(entryCiscoIOS);

  it("severity is Critical", () => {
    expect(result!.severity).toBe("Critical");
  });

  it("affected_cve is CVE-2023-20198", () => {
    expect(result!.affected_cve).toBe("CVE-2023-20198");
  });
});

describe("mapKevEntryToSignal — Progress MOVEit (CVSS 9.8 → Critical)", () => {
  const result = mapKevEntryToSignal(entryProgressMOVEit);

  it("severity is Critical", () => {
    expect(result!.severity).toBe("Critical");
  });

  it("affected_vendor is Progress", () => {
    expect(result!.affected_vendor).toBe("Progress");
  });

  it("normalized_summary mentions MOVEit Transfer", () => {
    expect(result!.normalized_summary).toContain("MOVEit Transfer");
  });
});

describe("mapKevEntryToSignal — GitLab (CVSS 7.5 → High)", () => {
  const result = mapKevEntryToSignal(entryGitLab);

  it("severity is High for CVSS 7.5", () => {
    expect(result!.severity).toBe("High");
  });

  it("affected_cve is CVE-2023-7028", () => {
    expect(result!.affected_cve).toBe("CVE-2023-7028");
  });

  it("affected_vendor is GitLab", () => {
    expect(result!.affected_vendor).toBe("GitLab");
  });
});

// ====================================================================
// mapKevEntryToSignal — invalid / edge cases
// ====================================================================

describe("mapKevEntryToSignal — invalid entries", () => {
  it("returns null when cveID is missing", () => {
    const entry = { ...entryMicrosoftWindows, cveID: "" };
    expect(mapKevEntryToSignal(entry)).toBeNull();
  });

  it("returns null when cveID does not match CVE format", () => {
    const entry = { ...entryMicrosoftWindows, cveID: "GHSA-1234-abcd-xxxx" };
    expect(mapKevEntryToSignal(entry)).toBeNull();
  });

  it("returns null when cveID is just letters", () => {
    const entry = { ...entryMicrosoftWindows, cveID: "notacve" };
    expect(mapKevEntryToSignal(entry)).toBeNull();
  });
});

describe("mapKevEntryToSignal — CVE ID normalization", () => {
  it("normalizes lowercase cveID to uppercase", () => {
    const entry = { ...entryMicrosoftWindows, cveID: "cve-2024-30080" };
    const result = mapKevEntryToSignal(entry);
    expect(result).not.toBeNull();
    expect(result!.affected_cve).toBe("CVE-2024-30080");
  });

  it("accepts mixed-case cveID", () => {
    const entry = { ...entryMicrosoftWindows, cveID: "Cve-2024-30080" };
    const result = mapKevEntryToSignal(entry);
    expect(result).not.toBeNull();
    expect(result!.affected_cve).toBe("CVE-2024-30080");
  });
});

describe("mapKevEntryToSignal — vendorProject absent", () => {
  it("affected_vendor is null when vendorProject is empty", () => {
    const entry = { ...entryMicrosoftWindows, vendorProject: "" };
    const result = mapKevEntryToSignal(entry);
    expect(result).not.toBeNull();
    expect(result!.affected_vendor).toBeNull();
  });
});

// ====================================================================
// mapKevEntryToSignal — output shape
// ====================================================================

describe("mapKevEntryToSignal — output shape", () => {
  it("output has exactly 7 keys", () => {
    const result = mapKevEntryToSignal(entryApacheLog4j);
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
