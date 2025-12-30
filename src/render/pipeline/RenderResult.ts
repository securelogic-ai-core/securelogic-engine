export interface RenderResult {
  target: string;
  artifactType: "PDF" | "DASHBOARD" | "JSON";
  artifactRef: string;
  artifactHash: string;
  generatedAt: string;
}
