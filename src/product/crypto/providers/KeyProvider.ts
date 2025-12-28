export interface KeyProvider {
  sign(data: Uint8Array, keyId: string): Uint8Array;
import { assertApprovedAlgorithm } from "../policy/assertApprovedAlgorithm";

  verify(data: Uint8Array, signature: Uint8Array, keyId: string): boolean;
    assertApprovedAlgorithm("ed25519");

}
