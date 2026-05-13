import { lookup as dnsLookup } from "node:dns/promises";
import { Agent } from "undici";
import ipaddr from "ipaddr.js";

/**
 * SSRF defense for customer-configured outbound webhook URLs (A10-G1).
 *
 * Defense layers:
 *  - URL parse + https-only protocol check.
 *  - Reject obvious metadata-service hostnames before DNS even runs.
 *  - DNS-resolve the hostname and reject if the resolved IP is in any
 *    non-routable range (loopback, RFC1918, link-local, CGNAT, multicast,
 *    reserved, broadcast, unspecified, ULA, IPv6 link-local, ...). IPv4-
 *    mapped IPv6 (::ffff:a.b.c.d) is unwrapped and the inner v4 is
 *    classified — otherwise ::ffff:169.254.169.254 would slip through.
 *  - At delivery, the caller pairs the validator with `buildPinnedAgent` so
 *    undici's connect() pins to the validated IP. This closes the DNS
 *    rebinding window: the IP we approved is the IP we connect to. The
 *    Agent does not re-resolve.
 *
 * Requires Node ≥20.18.1 (undici@7 engine requirement).
 */

export type BlockedReason =
  | "invalid_url"
  | "not_https"
  | "blocked_hostname"
  | "blocked_ip_range"
  | "dns_resolution_failed";

export class UnsafeWebhookUrlError extends Error {
  constructor(public reason: BlockedReason, public detail?: string) {
    super(`unsafe_webhook_url:${reason}${detail ? `:${detail}` : ""}`);
    this.name = "UnsafeWebhookUrlError";
  }
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "instance-data.ec2.internal",
  "metadata.azure.com",
]);

function classifyIp(ipString: string): { blocked: true; range: string } | { blocked: false } {
  let parsed: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    parsed = ipaddr.parse(ipString);
  } catch {
    return { blocked: true, range: "unparseable" };
  }

  if (parsed.kind() === "ipv6") {
    const v6 = parsed as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) {
      const v4Range = v6.toIPv4Address().range();
      if (v4Range !== "unicast") {
        return { blocked: true, range: `ipv4mapped:${v4Range}` };
      }
      return { blocked: false };
    }
  }

  const range = parsed.range();
  if (range !== "unicast") {
    return { blocked: true, range };
  }
  return { blocked: false };
}

export interface SafeWebhookTarget {
  ip: string;
  family: 4 | 6;
  hostname: string;
  port: number;
}

export async function assertSafeWebhookUrl(urlString: string): Promise<SafeWebhookTarget> {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new UnsafeWebhookUrlError("invalid_url");
  }

  if (url.protocol !== "https:") {
    throw new UnsafeWebhookUrlError("not_https");
  }

  const rawHost = url.hostname.toLowerCase();
  const bareHost = rawHost.replace(/^\[|\]$/g, "");

  if (BLOCKED_HOSTNAMES.has(bareHost)) {
    throw new UnsafeWebhookUrlError("blocked_hostname", bareHost);
  }

  let ip: string;
  let family: 4 | 6;

  if (ipaddr.isValid(bareHost)) {
    const parsed = ipaddr.parse(bareHost);
    ip = parsed.toNormalizedString();
    family = parsed.kind() === "ipv4" ? 4 : 6;
  } else {
    try {
      const resolved = await dnsLookup(bareHost, { family: 0, verbatim: true });
      ip = resolved.address;
      family = resolved.family as 4 | 6;
    } catch {
      throw new UnsafeWebhookUrlError("dns_resolution_failed", bareHost);
    }
  }

  const verdict = classifyIp(ip);
  if (verdict.blocked) {
    throw new UnsafeWebhookUrlError("blocked_ip_range", verdict.range);
  }

  const port = url.port ? parseInt(url.port, 10) : 443;

  return { ip, family, hostname: bareHost, port };
}

/**
 * Builds an undici Agent whose connect() pins to the pre-validated IP rather
 * than re-resolving DNS. Closing this gap is the actual TOCTOU defense — the
 * IP we approved is the IP we connect to.
 *
 * Caller is responsible for `await agent.close()` after the request completes.
 */
export function buildPinnedAgent(ip: string, family: 4 | 6): Agent {
  return new Agent({
    connect: {
      lookup: (_hostname, _options, callback) => {
        callback(null, ip, family);
      },
    },
  });
}
