import crypto from "crypto";

const SECRET = "PRISM_SIGNING_SECRET";

export function signArtifact(filename: string, ttlSeconds = 300) {
  const expires = Date.now() + ttlSeconds * 1000;
  const payload = JSON.stringify({ filename, expires });

  const sig = crypto
    .createHmac("sha256", SECRET)
    .update(payload)
    .digest("hex");

  return Buffer.from(JSON.stringify({ filename, expires, sig })).toString("base64url");
}
