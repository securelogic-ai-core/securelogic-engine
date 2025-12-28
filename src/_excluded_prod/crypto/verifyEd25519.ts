import nacl from "tweetnacl";
import { decodeUTF8 } from "tweetnacl-util";

export function verifyEd25519(
  message: string,
  signatureBase64: string,
  publicKeyBase64: string
): boolean {
  const msg = decodeUTF8(message);
  const sig = Buffer.from(signatureBase64, "base64");
  const pk = Buffer.from(publicKeyBase64, "base64");
  return nacl.sign.detached.verify(msg, sig, pk);
}
