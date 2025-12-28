export interface PublicKeyV1 {
  keyId: string;
  algorithm: "ed25519";
  publicKey: string;
  revoked?: boolean;
}

export interface TrustedAttester {
  attesterId: string;
  keys: PublicKeyV1[];
  revoked?: boolean;
}

const TRUSTED_ATTESTERS: TrustedAttester[] = [];

export function resolveTrustedAttester(
  attesterId: string
): TrustedAttester | null {
  return TRUSTED_ATTESTERS.find(
    a => a.attesterId === attesterId && !a.revoked
  ) ?? null;
}
