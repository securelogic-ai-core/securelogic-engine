import type { Request, Response, NextFunction } from "express";
import ipaddr from "ipaddr.js";
import { logger } from "../infra/logger.js";
import { resolveClientIp, type ClientIpSource } from "../infra/clientIp.js";

/**
 * requireAdminNetwork (Enterprise-grade)
 *
 * PURPOSE:
 * Restrict ALL /admin routes to an allowlisted set of IPs or CIDR ranges.
 *
 * WHY:
 * Admin endpoints are extremely sensitive.
 * Even with an admin key, you should require:
 *   - key possession
 *   - AND network location (defense in depth)
 *
 * CONFIG:
 *   SECURELOGIC_ADMIN_ALLOWED_IPS="1.2.3.4,5.6.7.0/24,10.0.0.0/8"
 *   SECURELOGIC_ADMIN_NETWORK_ENFORCED="true"   <-- see ROLLOUT below
 *
 * RULES:
 * - FAIL CLOSED if allowlist is missing/empty (when enforcing)
 * - Never logs headers or admin keys
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CLIENT IP: WHY THIS DOES NOT USE `req.ip`
 * ─────────────────────────────────────────────────────────────────────────────
 * It used to, and that made the control unusable. Measured against live staging
 * on 2026-08-11: a request from `172.191.151.49` arrived as `172.70.134.76`, and
 * the next from the same client as `172.71.190.23` — both Cloudflare edge nodes,
 * because Render fronts every service with Cloudflare and `trust proxy` is 1.
 *
 * Comparing a rotating CDN address against an allowlist of operator addresses
 * can only ever produce "no match". Wiring this middleware in while it read
 * `req.ip` would have returned 401 for 100% of admin requests on production —
 * a total admin lockout, failing closed on the wrong input. It now resolves the
 * caller through `infra/clientIp.ts`, which prefers Cloudflare's unforgeable
 * `CF-Connecting-IP`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ROLLOUT: DARK BY DEFAULT, AND DELIBERATELY SO
 * ─────────────────────────────────────────────────────────────────────────────
 * `SECURELOGIC_ADMIN_NETWORK_ENFORCED` must be exactly "true" to reject
 * anything. Default is DARK: classify, log, and continue.
 *
 * This is not timidity. The failure mode of a wrong allowlist is locking every
 * operator out of production admin — including the endpoints used to diagnose
 * being locked out. The allowlist currently holds two addresses that predate
 * this fix and have never once been compared against a correctly-resolved
 * client IP, because no code path resolved one. Dark mode emits exactly the
 * evidence needed to confirm the list is right (`admin_network_evaluated`, with
 * the resolved IP, its source, and the would-be verdict) before a single
 * request is refused. Same observe → prove → enforce discipline used for the
 * email environment isolation work.
 *
 * A `source` of "express" while running behind Cloudflare means the trusted
 * header did not arrive, and the address being tested is a CDN node. That is
 * treated as NOT allowed under enforcement, and is called out in the log,
 * because silently allowlisting a CDN edge would hand access to anyone sharing
 * it.
 */

const ENV_VAR = "SECURELOGIC_ADMIN_ALLOWED_IPS";
const ENFORCE_VAR = "SECURELOGIC_ADMIN_NETWORK_ENFORCED";

/**
 * Is the allowlist actually rejecting traffic on this service?
 *
 * Strict `=== "true"`, no NODE_ENV escape hatch, default off — the same shape
 * as every other gate in this codebase.
 */
export function adminNetworkEnforced(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env[ENFORCE_VAR] === "true";
}

type AllowedEntry =
  | { kind: "single"; addr: ipaddr.IPv4 | ipaddr.IPv6 }
  | { kind: "cidr"; range: [ipaddr.IPv4 | ipaddr.IPv6, number] };

function safeTrim(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length ? t : null;
}

function parseAllowlist(): AllowedEntry[] {
  const raw = safeTrim(process.env[ENV_VAR]);

  if (!raw) return [];

  const parts = raw
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x.length > 0);

  const parsed: AllowedEntry[] = [];

  for (const p of parts) {
    try {
      // CIDR
      if (p.includes("/")) {
        const cidr = ipaddr.parseCIDR(p);
        parsed.push({ kind: "cidr", range: cidr });
        continue;
      }

      // Single IP
      const addr = ipaddr.parse(p);
      parsed.push({ kind: "single", addr });
    } catch {
      // ignore invalid entries (but if ALL are invalid => fail closed later)
    }
  }

  return parsed;
}

function normalizeToComparable(
  addr: ipaddr.IPv4 | ipaddr.IPv6
): ipaddr.IPv4 | ipaddr.IPv6 {
  /**
   * Normalize IPv4-mapped IPv6 addresses.
   * Example: ::ffff:127.0.0.1 -> 127.0.0.1
   */
  if (addr.kind() === "ipv6" && (addr as ipaddr.IPv6).isIPv4MappedAddress()) {
    return (addr as ipaddr.IPv6).toIPv4Address();
  }

  return addr;
}

function isAllowed(
  client: ipaddr.IPv4 | ipaddr.IPv6,
  allowlist: AllowedEntry[]
): boolean {
  for (const entry of allowlist) {
    if (entry.kind === "single") {
      const a = normalizeToComparable(entry.addr);
      const c = normalizeToComparable(client);

      if (a.kind() !== c.kind()) continue;

      if (a.toString() === c.toString()) return true;
      continue;
    }

    if (entry.kind === "cidr") {
      const [rangeIp, prefix] = entry.range;

      const a = normalizeToComparable(rangeIp);
      const c = normalizeToComparable(client);

      if (a.kind() !== c.kind()) continue;

      /**
       * TypeScript FIX:
       * Narrow IPv4 vs IPv6 before calling match().
       * Otherwise TS cannot resolve the overload on a union type.
       */
      if (c.kind() === "ipv4" && a.kind() === "ipv4") {
        if ((c as ipaddr.IPv4).match(a as ipaddr.IPv4, prefix)) return true;
      }

      if (c.kind() === "ipv6" && a.kind() === "ipv6") {
        if ((c as ipaddr.IPv6).match(a as ipaddr.IPv6, prefix)) return true;
      }
    }
  }

  return false;
}

/** Why a request would be refused. `null` means it would be allowed. */
type Refusal = "misconfigured" | "no_client_ip" | "not_allowlisted";

export function requireAdminNetwork(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const enforcing = adminNetworkEnforced();

  try {
    const allowlist = parseAllowlist();
    const resolved = resolveClientIp(req);

    let refusal: Refusal | null = null;
    let clientAddr: ipaddr.IPv4 | ipaddr.IPv6 | null = null;

    /**
     * ENTERPRISE RULE:
     * Admin network restriction MUST be configured. If missing, fail closed.
     * An allowlist of zero entries cannot admit anyone, so treating it as
     * "allow all" would silently invert the control.
     */
    if (allowlist.length === 0) {
      refusal = "misconfigured";
    } else if (!resolved.ip) {
      refusal = "no_client_ip";
    } else {
      try {
        clientAddr = normalizeToComparable(ipaddr.parse(resolved.ip));
      } catch {
        // resolveClientIp already parsed it, so this is unreachable in
        // practice — but an unparseable address must never fall through to
        // "allowed".
        refusal = "no_client_ip";
      }

      if (clientAddr && !isAllowed(clientAddr, allowlist)) {
        refusal = "not_allowlisted";
      }
    }

    // One line per admin request, in BOTH modes. In dark mode this is the
    // entire point: it is the evidence that decides whether the allowlist is
    // correct before anything is refused.
    const telemetry = {
      event: "admin_network_evaluated",
      mode: enforcing ? "enforced" : "dark",
      route: req.originalUrl,
      method: req.method,
      clientIp: clientAddr ? clientAddr.toString() : null,
      // Which source produced that address. "express" behind Cloudflare means
      // the trusted header is absent and this is a CDN node, not the caller.
      ipSource: resolved.source satisfies ClientIpSource,
      expressIp: resolved.expressIp,
      allowlistEntries: allowlist.length,
      refusal,
      wouldBlock: refusal !== null
    };

    if (refusal === null) {
      logger.debug(telemetry, "requireAdminNetwork: allowed");
      next();
      return;
    }

    if (!enforcing) {
      logger.warn(
        telemetry,
        `requireAdminNetwork: WOULD BLOCK (${refusal}) — passing through, ${ENFORCE_VAR} is not "true"`
      );
      next();
      return;
    }

    if (refusal === "misconfigured") {
      logger.error(
        telemetry,
        "requireAdminNetwork: missing/empty admin allowlist (fail-closed)"
      );
      res.status(500).json({ error: "server_misconfigured" });
      return;
    }

    logger.warn(
      telemetry,
      "requireAdminNetwork: blocked admin request (IP not allowlisted)"
    );
    // Same opaque body as requireAdminKey: a caller learns only that they are
    // not authorised, never which of the two controls stopped them.
    res.status(401).json({ error: "admin_unauthorized" });
  } catch (err) {
    /**
     * FAIL CLOSED — but only where "closed" is the configured posture. In dark
     * mode an unexpected throw must not become the one code path that rejects
     * traffic, or enabling the gate would be the SECOND behaviour change rather
     * than the first.
     */
    logger.error(
      {
        err,
        event: "admin_network_error",
        mode: enforcing ? "enforced" : "dark",
        route: req.originalUrl,
        method: req.method
      },
      "requireAdminNetwork failed (fail-closed)"
    );

    if (!enforcing) {
      next();
      return;
    }

    res.status(401).json({ error: "admin_unauthorized" });
  }
}