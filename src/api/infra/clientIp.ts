/**
 * clientIp.ts — who is actually calling us.
 *
 * WHY THIS EXISTS
 * ---------------
 * `req.ip` is NOT the client's address in this deployment, and every control
 * that assumed it was has been reasoning about the wrong host.
 *
 * Measured on 2026-08-11 against the live staging service: a request from
 * `172.191.151.49` was recorded by the app as `172.70.134.76`, and a second
 * request from the same client as `172.71.190.23`. Both observed values are in
 * Cloudflare ranges. Both production and staging answer with
 * `server: cloudflare` and a `cf-ray` header, so Render fronts every service
 * with Cloudflare.
 *
 * The cause is `app.set("trust proxy", 1)` (app.ts). Express then treats
 * exactly one hop as trusted and resolves `req.ip` to the RIGHTMOST
 * X-Forwarded-For entry — which is the Cloudflare edge node that forwarded the
 * request, not the caller. That node changes as PoPs rotate, so `req.ip` is
 * both wrong and unstable.
 *
 * WHAT THIS BROKE (fixed 2026-08-11 via `resolveThrottleIdentity`, below)
 * ----------------------------------------------------------------------
 *   - `adminLockout` keyed its brute-force counter on `req.ip`, so the counter
 *     belonged to a SHARED Cloudflare edge. One abuser could lock out every
 *     legitimate admin behind the same PoP, and an attacker who rotated PoPs
 *     got a fresh allowance.
 *   - `adminRateLimit` keyed `admin:rate:${req.ip}` the same way.
 * Both now key on `resolveThrottleIdentity(req).key`. Thresholds, windows, and
 * fail-open/fail-closed semantics are unchanged; only the identity moved.
 *
 * THE HEADER WE TRUST, AND WHY
 * ----------------------------
 * `CF-Connecting-IP` is set by Cloudflare at the edge and OVERWRITTEN on every
 * request, so a caller cannot forge it: whatever they send is replaced before
 * the origin sees it. That property holds only while Cloudflare is genuinely in
 * front of the origin — which is true for `*.onrender.com`, where the service
 * is not addressable except through Render's edge.
 *
 * That assumption is the load-bearing one. It is stated here rather than buried
 * so that anyone moving these services off Render, or putting them behind a
 * different CDN, knows to revisit it. If the origin ever becomes directly
 * reachable, `CF-Connecting-IP` becomes attacker-controlled and every caller of
 * this module has to change.
 *
 * X-Forwarded-For is deliberately NOT parsed by hand here. Walking that header
 * ourselves would mean re-implementing the trust decision Express already owns,
 * in a second place, with a different bug surface. When no Cloudflare header is
 * present we fall back to `req.ip` and report WHICH source we used, so a caller
 * that needs certainty can refuse to act on a fallback value.
 */

import type { Request } from "express";
import ipaddr from "ipaddr.js";

/** Cloudflare's true-client-IP header. Overwritten at the edge on every request. */
export const CLOUDFLARE_CLIENT_IP_HEADER = "cf-connecting-ip";

export type ClientIpSource =
  /** From `CF-Connecting-IP` — the trustworthy path in this deployment. */
  | "cloudflare"
  /** From Express `req.ip`. Behind Cloudflare this is an EDGE address, not the caller. */
  | "express"
  /** Nothing parseable at all. */
  | "none";

export type ResolvedClientIp = {
  /** Normalised address, or null when nothing could be parsed. */
  ip: string | null;
  source: ClientIpSource;
  /**
   * `req.ip` as Express saw it, always reported. Keeping both sides visible is
   * what let the CDN-address problem be diagnosed at all, and it is what proves
   * a fix is working after rollout.
   */
  expressIp: string | null;
};

/** Length-capped so a hostile header cannot turn into a parse or log problem. */
const MAX_IP_LENGTH = 80;

function parseNormalized(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_IP_LENGTH) return null;

  try {
    const addr = ipaddr.parse(trimmed);
    // `::ffff:1.2.3.4` and `1.2.3.4` must compare equal against an allowlist.
    if (addr.kind() === "ipv6" && (addr as ipaddr.IPv6).isIPv4MappedAddress()) {
      return (addr as ipaddr.IPv6).toIPv4Address().toString();
    }
    return addr.toString();
  } catch {
    return null;
  }
}

/**
 * Resolve the calling client's address.
 *
 * Prefers `CF-Connecting-IP`; falls back to `req.ip`. The `source` field is
 * part of the contract, not debug decoration — a security control MUST be able
 * to tell "this is the real caller" from "this is whatever Express had", because
 * behind Cloudflare the second one is a CDN node and allowlisting it would be
 * meaningless.
 *
 * A comma-separated `CF-Connecting-IP` is rejected rather than split. Cloudflare
 * sends exactly one address; more than one means something else wrote the
 * header, and guessing which element to believe is how trust bugs are born.
 */
export function resolveClientIp(req: Request): ResolvedClientIp {
  const expressIp = parseNormalized(req.ip);

  const rawHeader = req.headers[CLOUDFLARE_CLIENT_IP_HEADER];
  // An array means the header appeared twice — same reasoning as the comma case.
  const headerValue = Array.isArray(rawHeader) ? null : rawHeader;
  const cloudflareIp =
    typeof headerValue === "string" && !headerValue.includes(",")
      ? parseNormalized(headerValue)
      : null;

  if (cloudflareIp) {
    return { ip: cloudflareIp, source: "cloudflare", expressIp };
  }

  if (expressIp) {
    return { ip: expressIp, source: "express", expressIp };
  }

  return { ip: null, source: "none", expressIp: null };
}

/**
 * The single shared bucket for callers whose address cannot be resolved AT ALL.
 *
 * Deliberately ONE constant rather than a per-request value: an unresolvable
 * caller must not receive its own private allowance. See below.
 */
export const UNRESOLVED_THROTTLE_KEY = "unresolved";

export type ThrottleIdentity = {
  /** The string embedded in the Redis key. Never null — see the sentinel above. */
  key: string;
  /** Resolved address, or null when nothing was parseable. */
  ip: string | null;
  source: ClientIpSource;
};

/**
 * Identity used to KEY the *enforcing* admin controls — `adminLockout` and
 * `adminRateLimit`.
 *
 * WHY THIS IS SEPARATE FROM resolveClientIp
 * -----------------------------------------
 * `resolveClientIp` answers "who is calling?" and is allowed to answer "I don't
 * know" (`ip: null`). A throttle key cannot be null — some string ends up in
 * Redis either way — so the "I don't know" case needs an explicit, deliberate
 * decision rather than whatever `${null}` stringifies to. That decision is the
 * whole point of this function.
 *
 * THE SPOOFING QUESTION, AND WHY THIS IS SAFE
 * -------------------------------------------
 * Trusting a header for an ENFORCING control is a stronger claim than trusting
 * it for a log line. If `CF-Connecting-IP` were caller-controlled, an attacker
 * could (a) rotate it per request for an unlimited admin-key brute force, and
 * (b) forge a legitimate operator's address to lock that operator out on demand.
 *
 * Measured against live staging on 2026-08-11 before this change was written:
 * Cloudflare REJECTS any request carrying a client-supplied `CF-Connecting-IP`
 * with `403 error code: 1000` at the edge. The request never reaches the origin.
 * Verified through normal DNS and by connecting directly to both published
 * origin addresses (216.24.57.15, 216.24.57.7) — all three paths returned the
 * same 403, the forged value never appeared in `admin_network_evaluated`
 * telemetry, and an otherwise-identical control request without the header
 * returned 200 with the true client address resolved. The header cannot be
 * smuggled past the edge, so it is sound to key enforcement on it.
 *
 * This inherits the load-bearing assumption documented at the top of this file:
 * it holds only while Cloudflare genuinely fronts the origin. If these services
 * ever become directly addressable, this function is one of the callers that
 * must change.
 *
 * WHY UNRESOLVED IS A SHARED BUCKET (the fail-safe direction)
 * ----------------------------------------------------------
 * When nothing is parseable, every such caller collapses onto ONE key. That is
 * the safe direction for an abuse control: unresolvable callers are throttled
 * COLLECTIVELY and hit the limit sooner, rather than each receiving a private
 * allowance. A per-request unique fallback would have been the exploit — it
 * would hand an attacker an unlimited budget precisely when identification
 * failed. This preserves the shape of the previous `req.ip || "unknown"`
 * sentinel in `adminLockout`, and fixes `adminRateLimit`, which previously
 * interpolated a bare `req.ip` and could produce the literal key
 * `admin:rate:undefined`.
 *
 * A `source` of "express" is still used as the key. Off Cloudflare (local dev,
 * tests, a directly-reachable deployment) `req.ip` IS the true caller, so that
 * is correct. Behind Cloudflare it means the trusted header was absent, which
 * degrades to exactly the previous behaviour rather than to something worse —
 * and it is not attacker-inducible, since a caller cannot strip a header
 * Cloudflare sets after it. Callers that need certainty read `source`.
 *
 * NOT a rejection decision: this function never refuses a request. Fail-open /
 * fail-closed behaviour (Redis readiness, thresholds, windows) stays exactly
 * where it already lives in each middleware.
 */
export function resolveThrottleIdentity(req: Request): ThrottleIdentity {
  const resolved = resolveClientIp(req);
  return {
    key: resolved.ip ?? UNRESOLVED_THROTTLE_KEY,
    ip: resolved.ip,
    source: resolved.source
  };
}
