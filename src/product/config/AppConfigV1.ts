export interface AppConfigV1 {
  environment: "prod" | "staging" | "dev";
  dataDir: string;
  auditDir: string;
}
