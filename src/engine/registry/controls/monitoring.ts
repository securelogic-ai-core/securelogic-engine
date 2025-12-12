import { ControlDefinition } from "../../contracts/ControlDefinition";

export const MonitoringControls: Record<string, ControlDefinition> = {
  "monitoring.modelMonitoring": {
    id: "MON-001",
    title: "Model Monitoring",
    description: "Models are monitored for drift and degradation.",

    domain: "Monitoring",
    severity: "High",
    controlType: "Detective",
    riskCategory: "Monitoring",
    frameworks: { iso42001: "A.8.1", nistAiRmf: "MONITOR-1" },
    baseWeight: 5,
    maturityHint: "Implement automated drift detection.",
    rationaleTemplate: "Model monitoring is insufficient or absent."
  }
};
