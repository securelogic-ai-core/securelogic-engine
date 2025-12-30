import crypto from "crypto";

const SECRET = "PRISM_SIGNING_SECRET";

export function verifySignedArtifact(token: string) {
  const decoded = JSON.parse(Buffer.from(token, "base64url").toString());
  const { filename, expires, sig } = decoded;

  if (Date.now() > expires) throw new Error("TOKEN_EXPIRED");

  const expected = crypto
    .createHmac("sha256", SECRET)
    .update(JSON.stringify({ filename, expires }))
    .digest("hex");

  if (expected !== sig) throw new Error("INVALID_SIGNATURE");

  return filename;
}
