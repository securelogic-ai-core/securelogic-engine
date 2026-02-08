import type { Request, Response, NextFunction } from "express";
import ipaddr from "ipaddr.js";
import { logger } from "../infra/logger.js";

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
 *
 * RULES:
 * - FAIL CLOSED if allowlist is missing/empty
 * - Works behind proxies (requires app.set("trust proxy", 1))
 * - Never logs headers or admin keys
 */

const ENV_VAR = "SECURELOGIC_ADMIN_ALLOWED_IPS";

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

function getClientIp(req: Request): string | null {
  /**
   * Express sets req.ip based on trust proxy config.
   * This is the safest way to do this in Express.
   */
  const ip = safeTrim(req.ip);
  if (!ip) return null;

  // prevent log/parse abuse
  if (ip.length > 80) return null;

  return ip;
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

export function requireAdminNetwork(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  try {
    const allowlist = parseAllowlist();

    /**
     * ENTERPRISE RULE:
     * Admin network restriction MUST be configured.
     * If missing, fail closed.
     */
    if (allowlist.length === 0) {
      logger.error(
        {
          event: "admin_network_misconfigured",
          envVar: ENV_VAR,
          route: req.originalUrl,
          method: req.method
        },
        "requireAdminNetwork: missing/empty admin allowlist (fail-closed)"
      );

      res.status(500).json({ error: "server_misconfigured" });
      return;
    }

    const ipRaw = getClientIp(req);

    if (!ipRaw) {
      logger.warn(
        {
          event: "admin_network_missing_ip",
          route: req.originalUrl,
          method: req.method
        },
        "requireAdminNetwork: missing client IP"
      );

      res.status(401).json({ error: "admin_unauthorized" });
      return;
    }

    let clientAddr: ipaddr.IPv4 | ipaddr.IPv6;

    try {
      clientAddr = normalizeToComparable(ipaddr.parse(ipRaw));
    } catch {
      logger.warn(
        {
          event: "admin_network_invalid_ip",
          route: req.originalUrl,
          method: req.method
        },
        "requireAdminNetwork: invalid client IP"
      );

      res.status(401).json({ error: "admin_unauthorized" });
      return;
    }

    const ok = isAllowed(clientAddr, allowlist);

    if (!ok) {
      logger.warn(
        {
          event: "admin_network_blocked",
          route: req.originalUrl,
          method: req.method,
          clientIp: clientAddr.toString()
        },
        "requireAdminNetwork: blocked admin request (IP not allowlisted)"
      );

      res.status(401).json({ error: "admin_unauthorized" });
      return;
    }

    next();
  } catch (err) {
    /**
     * FAIL CLOSED.
     * Admin security middleware must never fail open.
     */
    logger.error(
      {
        err,
        route: req.originalUrl,
        method: req.method
      },
      "requireAdminNetwork failed (fail-closed)"
    );

    res.status(401).json({ error: "admin_unauthorized" });
  }
}