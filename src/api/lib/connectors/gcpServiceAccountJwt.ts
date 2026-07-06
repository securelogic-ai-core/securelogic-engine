/**
 * gcpServiceAccountJwt.ts — ERIP Epic 2 (E2.P5): mint a signed JWT assertion
 * for the Google service-account OAuth flow (RFC 7523 / Google "Using OAuth 2.0
 * for Server to Server Applications"). Pure (Node crypto only); the caller
 * exchanges the assertion for an access token over HTTP.
 *
 * Real-credential round-trips are operator-owned (connector ledger); this
 * module is unit-tested for structural conformance + signature verifiability.
 */

import { createSign, createVerify } from "node:crypto";

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface JwtAssertionInput {
  /** Service-account email (the JWT `iss` and `sub`). */
  clientEmail: string;
  /** PEM-encoded RSA private key. */
  privateKeyPem: string;
  /** OAuth scope(s), space-delimited. */
  scope: string;
  /** Token endpoint (the `aud`), default https://oauth2.googleapis.com/token. */
  audience?: string;
  /** Issued-at epoch seconds (injected — no Date.now in this pure module). */
  iat: number;
  /** Lifetime seconds (Google caps at 3600). */
  lifetimeSeconds?: number;
}

const DEFAULT_AUD = "https://oauth2.googleapis.com/token";
const MAX_LIFETIME = 3600;

/** Build and RS256-sign the OAuth assertion JWT. Returns the compact token. */
export function mintServiceAccountAssertion(input: JwtAssertionInput): string {
  const aud = input.audience ?? DEFAULT_AUD;
  const lifetime = Math.min(input.lifetimeSeconds ?? MAX_LIFETIME, MAX_LIFETIME);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: input.clientEmail,
    sub: input.clientEmail,
    scope: input.scope,
    aud,
    iat: input.iat,
    exp: input.iat + lifetime
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(input.privateKeyPem);
  return `${signingInput}.${base64url(signature)}`;
}

/** Verify a minted assertion against a public key (test helper). */
export function verifyAssertion(token: string, publicKeyPem: string): boolean {
  const [header, claims, signature] = token.split(".");
  if (header === undefined || claims === undefined || signature === undefined) return false;
  const sig = Buffer.from(signature.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  return createVerify("RSA-SHA256").update(`${header}.${claims}`).verify(publicKeyPem, sig);
}

/** Decode a compact JWT's claim set (test/debug helper; no verification). */
export function decodeClaims(token: string): Record<string, unknown> {
  const claims = token.split(".")[1];
  if (claims === undefined) throw new Error("malformed jwt");
  return JSON.parse(Buffer.from(claims.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
}
