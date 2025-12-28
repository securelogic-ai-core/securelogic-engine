import nacl from "tweetnacl";
import type { KeyProvider } from "./KeyProvider";

export class LocalEd25519Provider implements KeyProvider {
  constructor(
    private readonly keys: Record<string, { publicKey: Uint8Array; secretKey: Uint8Array }>
  ) {}

  sign(data: Uint8Array, keyId: string): Uint8Array {
    return nacl.sign.detached(data, this.keys[keyId].secretKey);
  }

  verify(data: Uint8Array, signature: Uint8Array, keyId: string): boolean {
    return nacl.sign.detached.verify(
      data,
      signature,
      this.keys[keyId].publicKey
    );
  }
}
