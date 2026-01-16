export type ControlType =
  | "Preventive"
  | "Detective"
  | "Corrective";

export interface ControlFrameworkMap {
  iso42001?: string;
  nistAiRmf?: string;
  soc2?: string;
}

export interface ControlDynamicModifiers {
  genAIUsage?: number;
  sensitiveData?: number;
  highRiskIndustry?: number;
  enterpriseScale?: number;
}

export interface ControlDefinition {
  id: string;
  title: string;
  description: string;

  domain: string;
  riskCategory: string;

  severity: "Low" | "Medium" | "High" | "Critical";
  controlType: ControlType;

  baseWeight: number;

  maturityHint?: string;
  rationaleTemplate?: string;

  frameworks?: ControlFrameworkMap;
  dynamicModifiers?: ControlDynamicModifiers;
}
