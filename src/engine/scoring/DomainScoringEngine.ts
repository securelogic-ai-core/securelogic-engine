import type { Finding, RiskLevel } from "../../reporting/ReportSchema.js";
import { EnterpriseEscalationPolicy } from "./policy/EnterpriseEscalationPolicy.js";

export type DomainScoreResult = {
  domain: string;
  severity: RiskLevel;
  findings: Finding[];
};

export class DomainScoringEngine {
  static score(findings: Finding[]): DomainScoreResult[] {
    const byDomain = new Map<string, Finding[]>();

    for (const f of findings) {
      if (!byDomain.has(f.domain)) {
        byDomain.set(f.domain, []);
      }
      byDomain.get(f.domain)!.push(f);
    }

    const results: DomainScoreResult[] = [];

    for (const [domain, domainFindings] of byDomain.entries()) {
      const severity = EnterpriseEscalationPolicy.escalate(
        domainFindings.map(f => f.severity)
      );

      results.push({
        domain,
        severity,
        findings: domainFindings
      });
    }

    return results;
  }
}
