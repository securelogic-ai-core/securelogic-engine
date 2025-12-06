export class PolicyExtractor {
  static requiredPolicies = [
    "access control policy",
    "incident response policy",
    "change management policy",
    "business continuity policy"
  ];

  static extract(text: string) {
    const lower = text.toLowerCase();

    const found: string[] = [];
    const missing: string[] = [];

    this.requiredPolicies.forEach(policy => {
      if (lower.includes(policy)) {
        found.push(policy);
      } else {
        missing.push(policy);
      }
    });

    return { found, missing };
  }
}
