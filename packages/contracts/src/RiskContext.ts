export type RiskContext = {
  contextId: string;
  subjectType: "VENDOR" | "SYSTEM" | "AI_MODEL" | "ENVIRONMENT";
  subjectName: string;

  businessCriticality: "LOW" | "MEDIUM" | "HIGH";
  dataSensitivity: "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "REGULATED";
  exposure: "INTERNAL" | "INTERNET_FACING" | "EXTERNAL_DEPENDENCY";

  intendedUse: string;
  regulatoryDrivers: string[];

  createdAt: string;
};
