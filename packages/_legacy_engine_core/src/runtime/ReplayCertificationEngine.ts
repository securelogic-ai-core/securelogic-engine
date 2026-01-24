import { canonicalHash } from "./canonicalHash.js";
import { verifySignatureBytes } from "./ExecutionCrypto.js";

export async function certifyExecution(exec: any, previous: any | null): Promise<boolean> {
  try {
    // 1. Payload hash must match
    const expectedHash = canonicalHash(exec.payload);
    if (exec.payloadHash !== expectedHash) return false;

    // 2. Must have signatures
    if (!Array.isArray(exec.signatures) || exec.signatures.length === 0) return false;
    if (!exec.signerPublicKey) return false;

    const pub = Uint8Array.from(Buffer.from(exec.signerPublicKey, "base64"));

    // 3. Verify each signature
    for (const sig of exec.signatures) {
      if (typeof sig !== "string") return false;
      const sigBytes = Uint8Array.from(Buffer.from(sig, "base64"));
      const ok = await verifySignatureBytes(pub, sigBytes, exec.payloadHash);
      if (!ok) return false;
    }

    // 4. Chain check
    if (previous) {
      if (exec.previousHash !== previous.payloadHash) return false;
    }

    return true;
  } catch {
    return false;
  }
}
