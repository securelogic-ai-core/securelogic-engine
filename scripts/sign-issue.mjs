#!/usr/bin/env node
import fs from "node:fs";
import crypto from "node:crypto";

function die(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

function canonicalize(value) {
  const seen = new WeakSet();
  const normalize = (v) => {
    if (v === null) return null;

    const t = typeof v;
    if (t === "string" || t === "number" || t === "boolean") return v;
    if (t === "bigint") return v.toString();
    if (t === "undefined" || t === "function" || t === "symbol") return null;

    if (Array.isArray(v)) return v.map(normalize);

    if (t === "object") {
      if (seen.has(v)) throw new Error("payload_not_serializable_cyclic");
      seen.add(v);
      const keys = Object.keys(v).sort();
      const out = {};
      for (const k of keys) out[k] = normalize(v[k]);
      return out;
    }

    return null;
  };

  return JSON.stringify(normalize(value));
}

const [, , inPath, outPath] = process.argv;

if (!inPath || !outPath) {
  die("Usage: node scripts/sign-issue.mjs <issue.json> <signed-issue.json>");
}

const secret = process.env.SECURELOGIC_SIGNING_SECRET?.trim();
if (!secret || secret.length < 16) {
  die("SECURELOGIC_SIGNING_SECRET is missing or too short (min 16 chars).");
}

let issue;
try {
  issue = JSON.parse(fs.readFileSync(inPath, "utf8"));
} catch (e) {
  die(`Failed to read/parse input JSON: ${String(e)}`);
}

const msg = canonicalize(issue);
const bytes = Buffer.byteLength(msg, "utf8");
if (bytes > 512_000) {
  die(`Issue payload too large (${bytes} bytes). Max is 512000.`);
}

const signature = crypto
  .createHmac("sha256", secret)
  .update(msg, "utf8")
  .digest("base64");

const signedAt = new Date().toISOString();

const artifact = {
  issue,
  signature,
  signedAt
};

fs.writeFileSync(outPath, JSON.stringify(artifact, null, 2) + "\n", "utf8");
console.log(`✅ Signed issue -> ${outPath}`);
