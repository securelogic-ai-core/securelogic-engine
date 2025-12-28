export interface DeploymentContextV1 {
  version: string;
  environment: "prod" | "staging";
  approvedBy: string;
}
