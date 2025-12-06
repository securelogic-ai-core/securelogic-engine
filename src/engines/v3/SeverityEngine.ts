export class SeverityEngineV3 {
  /**
   * Classifies severity based on the FINAL computed risk value.
   * This is intentionally simple and rule-independent.
   * Rules modify likelihood/risk; this engine only classifies.
   */
  static classify(risk: number): "Low" | "Medium" | "High" | "Critical" {
    if (risk >= 15) return "Critical";
    if (risk >= 9) return "High";
    if (risk >= 5) return "Medium";
    return "Low";
  }
}
