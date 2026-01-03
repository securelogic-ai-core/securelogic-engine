import type { ControlDefinition } from "../../contracts/ControlDefinition.js";

export const DataQualityControls: Record<string, ControlDefinition> = {
  "dataQuality.dataLineage": {
    id: "DQ-001",
    title: "Data Lineage Tracked",
    description: "Lineage from data source through model output is documented.",

    domain: "Data Quality",
    riskCategory: "Data Quality",

    severity: "High",

    controlType: "Preventive",
    frameworks: { iso42001: "A.6.2", nistAiRmf: "MAP-1" },
    baseWeight: 4,
    maturityHint: "Implement automated lineage tracking where possible.",
    rationaleTemplate: "Data lineage is not consistently tracked across AI workflows."
  }
};
