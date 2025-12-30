import crypto from "crypto";

const SECRET = process.env.ARTIFACT_SIGNING_KEY || "dev-secret";

export function signArtifact(filename: string, expiresAt: number) {
  const payload = `${filename}:${expiresAt}`;
  const sig = crypto
    .createHmac("sha256", SECRET)
    .update(payload)
    .digest("hex");

  return Buffer.from(
    JSON.stringify({ filename, expiresAt, sig })
  ).toString("base64url");
}

export function verifyArtifact(token: string) {
  const decoded = JSON.parse(
    Buffer.from(token, "base64url").toString()
  );

  const payload = `${decoded.filename}:${decoded.expiresAt}`;
  const expected = crypto
    .createHmac("sha256", SECRET)
    .update(payload)
    .digest("hex");

  if (expected !== decoded.sig) throw new Error("INVALID_SIGNATURE");
  if (Date.now() > decoded.expiresAt) throw new Error("TOKEN_EXPIRED");

  return decoded.filename;
}
