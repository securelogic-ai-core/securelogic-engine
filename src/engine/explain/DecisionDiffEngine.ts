export type Severity = "Low" | "Moderate" | "High" | "Critical";

export interface DiffResult {
  severityChanged: boolean;
  fromSeverity: Severity;
  toSeverity: Severity;

  addedDrivers: string[];
  removedDrivers: string[];

  domainScoreChanges: {
    domain: string;
    from?: number;
    to?: number;
  }[];

  summary: string;
}

export class DecisionDiffEngine {
  static diff(before: any, after: any): DiffResult {
    const beforeDecision = before.decision;
    const afterDecision = after.decision;

    const severityChanged = beforeDecision.severity !== afterDecision.severity;

    const beforeDrivers = new Set<string>(beforeDecision.drivers || []);
    const afterDrivers = new Set<string>(afterDecision.drivers || []);

    const addedDrivers = [...afterDrivers].filter(d => !beforeDrivers.has(d));
    const removedDrivers = [...beforeDrivers].filter(d => !afterDrivers.has(d));

    const domainScoreChanges: {
      domain: string;
      from?: number;
      to?: number;
    }[] = [];

    const beforeDomains =
      beforeDecision.trace?.domains
        ? new Map(
            beforeDecision.trace.domains.map((d: any) => [d.domain, d.finalScore])
          )
        : new Map();

    const afterDomains =
      afterDecision.trace?.domains
        ? new Map(
            afterDecision.trace.domains.map((d: any) => [d.domain, d.finalScore])
          )
        : new Map();

    const allDomains = new Set([
      ...beforeDomains.keys(),
      ...afterDomains.keys()
    ]);

    for (const domain of allDomains) {
      const from = beforeDomains.get(domain);
      const to = afterDomains.get(domain);

      if (from !== to) {
        domainScoreChanges.push({ domain, from, to });
      }
    }

    let summary = "";

    if (severityChanged) {
      summary += `Overall severity changed from ${beforeDecision.severity} to ${afterDecision.severity}. `;
    }

    if (addedDrivers.length || removedDrivers.length) {
      summary += `Drivers changed. `;
    }

    if (domainScoreChanges.length) {
      summary += `Domain scores changed in ${domainScoreChanges.length} domains. `;
    }

    if (!summary) {
      summary = "No material decision differences detected.";
    }

    return {
      severityChanged,
      fromSeverity: beforeDecision.severity,
      toSeverity: afterDecision.severity,
      addedDrivers,
      removedDrivers,
      domainScoreChanges,
      summary: summary.trim()
    };
  }
}
