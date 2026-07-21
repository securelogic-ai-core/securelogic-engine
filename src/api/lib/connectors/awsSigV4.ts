/**
 * awsSigV4.ts — ERIP Epic 2 (E2.P5): a compact, dependency-free AWS Signature
 * Version 4 signer for the AWS connector. Pure (Node crypto only), no network.
 *
 * Implements the canonical SigV4 algorithm (AWS "Signature Version 4 signing
 * process"): canonical request → string to sign → derived signing key →
 * signature → Authorization header. Only the subset the connector needs is
 * covered: a single POST to a regional JSON endpoint with a body, host +
 * x-amz-date (+ optional x-amz-target) headers, empty query string.
 *
 * Real-credential round-trips are operator-owned (connector ledger); this
 * module is unit-tested for spec conformance + determinism.
 */

import { createHash, createHmac } from "node:crypto";

function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

export interface SigV4Input {
  method: string;
  host: string;
  region: string;
  service: string;
  path: string; // canonical URI, e.g. "/"
  body: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** ISO basic UTC, e.g. 20150830T123600Z. Injected (no Date.now in this pure module). */
  amzDate: string;
  /** Extra signed headers (lowercased keys), e.g. { "x-amz-target": "..." }. */
  extraHeaders?: Record<string, string>;
}

/** Derive the SigV4 signing key: HMAC chain over date → region → service → aws4_request. */
export function deriveSigningKey(secretAccessKey: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

export interface SignedRequest {
  headers: Record<string, string>;
  authorization: string;
}

/**
 * Sign a request and return the headers to send (host, x-amz-date, any extra
 * signed headers, and Authorization). content-type is NOT signed here — callers
 * that need it should pass it via extraHeaders.
 */
export function signAwsRequest(input: SigV4Input): SignedRequest {
  const dateStamp = input.amzDate.slice(0, 8);
  const extra = input.extraHeaders ?? {};

  // Canonical headers: host + x-amz-date + extras, sorted by lowercased name.
  const headerMap: Record<string, string> = {
    host: input.host,
    "x-amz-date": input.amzDate,
    ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k.toLowerCase(), v.trim()]))
  };
  const signedHeaderNames = Object.keys(headerMap).sort();
  const canonicalHeaders = signedHeaderNames.map((h) => `${h}:${headerMap[h]}\n`).join("");
  const signedHeaders = signedHeaderNames.join(";");

  const payloadHash = sha256Hex(input.body);
  const canonicalRequest = [
    input.method,
    input.path,
    "", // empty canonical query string
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join("\n");

  const scope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", input.amzDate, scope, sha256Hex(canonicalRequest)].join("\n");

  const signingKey = deriveSigningKey(input.secretAccessKey, dateStamp, input.region, input.service);
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    headers: { ...headerMap, Authorization: authorization },
    authorization
  };
}
