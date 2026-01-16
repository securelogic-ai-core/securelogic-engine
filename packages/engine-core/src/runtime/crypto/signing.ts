import crypto from "crypto";

export interface SignatureBundle {
  algorithm: string;
  publicKey: string;
  signature: string;
}

export function generateKeyPair() {
  return crypto.generateKeyPairSync("rsa", {
    modulusLength: 4096,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" }
  });
}

export function signObject(obj: unknown, privateKeyPem: string): SignatureBundle {
  const data = JSON.stringify(obj);

  const signer = crypto.createSign("RSA-SHA256");
  signer.update(data);
  signer.end();

  const signature = signer.sign(privateKeyPem, "base64");

  return {
    algorithm: "RSA-SHA256",
    publicKey: "", // filled by caller
    signature
  };
}

export function verifyObjectSignature(
  obj: unknown,
  bundle: SignatureBundle
): boolean {
  const data = JSON.stringify(obj);

  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(data);
  verifier.end();

  return verifier.verify(bundle.publicKey, bundle.signature, "base64");
}
