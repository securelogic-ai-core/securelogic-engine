export interface IPCv1Document {
  name: string;
  type: string;
  rawContent: string;
  extractedText?: string | null;
  source: "upload" | "url" | "email" | "api";
}

export interface IPCv1Signals {
  missingPolicies?: string[];
  foundControls?: string[];
  gapsDetected?: string[];
  riskIndicators?: string[];
}

export interface IPCv1Normalized {
  textBlocks: string[];
  tokens: string[];
  metadata: Record<string, string | number | boolean>;
}

export interface IPCv1Output {
  documents: IPCv1Document[];
  normalized: IPCv1Normalized[];
  signals: IPCv1Signals;
  ingestionNotes?: string[];
}

export const IPC_VERSION = "1.0.0";
