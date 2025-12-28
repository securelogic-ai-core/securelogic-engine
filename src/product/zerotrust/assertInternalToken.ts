import type { InternalServiceTokenV1 } from "./InternalServiceTokenV1";

export function assertInternalToken(t: InternalServiceTokenV1): void {
  if (new Date(t.expiresAt).getTime() <= Date.now()) {
    throw new Error("INTERNAL_TOKEN_EXPIRED");
  }
}
