export class FrameworkSelectorEngine {

  /**
   * Selects frameworks based on intake fields.
   * Deterministic, rule-based, auditable.
   */
  static select(intake: any): string[] {
    const selected: string[] = [];

    // Always included: NIST CSF 2.0 baseline
    selected.push("NIST-CSF");

    // AI-specific triggers
    if (intake.usesAI === true || (intake.triggers || []).includes("ai")) {
      selected.push("NIST-AI-RMF");
      selected.push("ISO-42001");
    }

    // Cloud or SaaS offering
    if (intake.isSaaS === true || (intake.triggers || []).includes("saas")) {
      selected.push("SOC2");
      selected.push("ISO-27001");
    }

    // EU considerations
    if (intake.hasEUCustomers === true) {
      selected.push("EU-AIACT");
      selected.push("GDPR");
    }

    // Remove duplicates
    return Array.from(new Set(selected));
  }

}
