export class RiskIndicatorMapper {
  static riskPatterns = [
    { keyword: "no formal policy", indicator: "Lack of formal documentation" },
    { keyword: "not monitored", indicator: "Monitoring gap" },
    { keyword: "no evidence", indicator: "Evidence missing" },
    { keyword: "manual process", indicator: "Automation gap" },
    { keyword: "pending remediation", indicator: "Open findings" }
  ];

  static map(text: string) {
    const lower = text.toLowerCase();
    const found: string[] = [];

    this.riskPatterns.forEach(p => {
      if (lower.includes(p.keyword)) {
        found.push(p.indicator);
      }
    });

    return found;
  }
}
