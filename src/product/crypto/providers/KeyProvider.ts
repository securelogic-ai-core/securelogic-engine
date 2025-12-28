import { assertApprovedAlgorithm } from "../policy/assertApprovedAlgorithm";
ssertApprovedAlgorithm("ed25519");

export interface KeyProvider {
ssertApprovedAlgorithm("ed25519");

  sign(data: Uint8Array, keyId: string): Uint8Array;
ssertApprovedAlgorithm("ed25519");


ssertApprovedAlgorithm("ed25519");

  verify(data: Uint8Array, signature: Uint8Array, keyId: string): boolean;

ssertApprovedAlgorithm("ed25519");


ssertApprovedAlgorithm("ed25519");

}
ssertApprovedAlgorithm("ed25519");

