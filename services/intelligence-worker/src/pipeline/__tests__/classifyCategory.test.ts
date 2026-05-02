import { describe, it, expect } from "vitest";
import { classifyCategory } from "../classifyCategory.js";

describe("classifyCategory", () => {
  describe("VULNERABILITY precedence (bug 1 fix)", () => {
    it("classifies a CVE patch headline as VULNERABILITY (not SECURITY_INCIDENT)", () => {
      const result = classifyCategory("Microsoft patches CVE-2024-12345 in Edge", "");
      expect(result.primary).toBe("VULNERABILITY");
    });

    it("classifies a CISA KEV catalog addition as VULNERABILITY (not REGULATION)", () => {
      const result = classifyCategory("CISA adds vulnerability to KEV catalog", "");
      expect(result.primary).toBe("VULNERABILITY");
    });

    it("classifies a vendor RCE advisory as VULNERABILITY", () => {
      const result = classifyCategory(
        "Cisco issues security advisory for critical RCE vulnerability",
        ""
      );
      expect(result.primary).toBe("VULNERABILITY");
    });

    it("classifies Patch Tuesday rollups as VULNERABILITY (not SECURITY_INCIDENT via 'zero-day')", () => {
      const result = classifyCategory(
        "Microsoft Patch Tuesday addresses 60 vulnerabilities including 6 zero-days",
        ""
      );
      expect(result.primary).toBe("VULNERABILITY");
    });

    it("classifies privilege-escalation advisories as VULNERABILITY", () => {
      const result = classifyCategory("Linux kernel privilege escalation flaw discovered", "");
      expect(result.primary).toBe("VULNERABILITY");
    });

    it("classifies CVSS-score headlines as VULNERABILITY", () => {
      const result = classifyCategory("CVSS 9.8 flaw in OpenSSL warrants immediate patching", "");
      expect(result.primary).toBe("VULNERABILITY");
    });
  });

  describe("SECURITY_INCIDENT preserved for incident/campaign content", () => {
    it("classifies ransomware campaign headlines as SECURITY_INCIDENT", () => {
      const result = classifyCategory(
        "LockBit ransomware crew claims attack on logistics firm",
        ""
      );
      expect(result.primary).toBe("SECURITY_INCIDENT");
    });

    it("classifies breach announcements as SECURITY_INCIDENT", () => {
      const result = classifyCategory("Major breach at Acme Corp affecting 50M customers", "");
      expect(result.primary).toBe("SECURITY_INCIDENT");
    });

    it("classifies a ransomware-on-hospital headline as SECURITY_INCIDENT, not VULNERABILITY", () => {
      // Regression: makes sure the new VULNERABILITY bucket doesn't hijack
      // pure-incident content that lacks vulnerability vocabulary.
      const result = classifyCategory("Ransomware operators breach hospital network", "");
      expect(result.primary).toBe("SECURITY_INCIDENT");
    });
  });

  describe("REGULATION preserved", () => {
    it("classifies enforcement actions as REGULATION", () => {
      const result = classifyCategory("FTC announces enforcement action against data broker", "");
      expect(result.primary).toBe("REGULATION");
    });

    it("classifies regulatory framework updates as REGULATION", () => {
      const result = classifyCategory(
        "NIST publishes updated cybersecurity framework 2.0 guidance",
        ""
      );
      expect(result.primary).toBe("REGULATION");
    });
  });

  describe("AI_GOVERNANCE preserved", () => {
    it("classifies AI governance announcements as AI_GOVERNANCE", () => {
      const result = classifyCategory("Anthropic releases updated AI governance framework", "");
      expect(result.primary).toBe("AI_GOVERNANCE");
    });
  });

  describe("fallback", () => {
    it("returns GENERAL when no buckets match", () => {
      const result = classifyCategory("Q3 earnings beat market expectations", "");
      expect(result.primary).toBe("GENERAL");
      expect(result.reason).toBe("fallback:no-match");
    });
  });

  describe("matches array preserves all detected categories", () => {
    it("includes both VULNERABILITY and SECURITY_INCIDENT when both regexes hit", () => {
      const result = classifyCategory("Microsoft patches CVE-2024-12345 in Edge", "");
      expect(result.all).toContain("VULNERABILITY");
      expect(result.all).toContain("SECURITY_INCIDENT");
      expect(result.all[0]).toBe("VULNERABILITY");
    });
  });
});
