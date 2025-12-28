import type { TrustedKey } from "./TrustedKey";
import { trustedKeys } from "./trustedKeys";

export function isTrustedKey(
  keyId: string,
  signedAt: string
): boolean {
  const ts = Date.parse(signedAt);

  return trustedKeys.some((k: TrustedKey) => {
    if (k.keyId !== keyId) return false;
    if (Date.parse(k.activeFrom) > ts) return false;
    if (k.revokedAt && Date.parse(k.revokedAt) <= ts) return false;
    return true;
  });
}
