import crypto from "crypto";

export function signResultEnvelope(envelope: any) {
  const hash = crypto
    .createHash("sha256")
    .update(JSON.stringify(envelope.payload))
    .digest("hex");

  envelope.signatures.push({
    algorithm: "sha256",
    value: hash
  });

  return envelope;
}
