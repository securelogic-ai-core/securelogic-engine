export interface KeyProvider {
  sign(data: Uint8Array, keyId: string): Uint8Array;
  verify(data: Uint8Array, signature: Uint8Array, keyId: string): boolean;
}
