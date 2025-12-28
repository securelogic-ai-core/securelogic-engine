import type { SecretAccessRequestV1 } from "./SecretAccessRequestV1";

export function assertSecretAccess(
  request: SecretAccessRequestV1
): void {
  if (!request.purpose || !request.actorId) {
    throw new Error("SECRET_ACCESS_DENIED");
  }
}
