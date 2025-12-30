export type ArtifactRecord = {
  runId: string;
  artifactId: string;
  type: "PDF" | "DASHBOARD";
  filename: string;
  path: string;
  size: number;
  checksum: string;
  createdAt: string;
};
