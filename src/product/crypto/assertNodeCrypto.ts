import crypto from "crypto";

export function assertNodeCrypto() {
  if (!crypto?.createHash) {
    throw new Error("UNSUPPORTED_CRYPTO_PROVIDER");
  }
}
