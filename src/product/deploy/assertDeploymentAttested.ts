import type { DeploymentAttestationV1 } from "./DeploymentAttestationV1";

export function assertDeploymentAttested(a: DeploymentAttestationV1): void {
  if (!a.attestedBy || !a.attestedAt) {
    throw new Error("DEPLOYMENT_NOT_ATTESTED");
  }
}
