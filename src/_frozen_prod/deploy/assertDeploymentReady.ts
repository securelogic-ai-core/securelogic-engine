import type { DeploymentContextV1 } from "./DeploymentContextV1";

export function assertDeploymentReady(ctx: DeploymentContextV1): void {
  if (!ctx.approvedBy) {
    throw new Error("DEPLOYMENT_NOT_APPROVED");
  }
}
