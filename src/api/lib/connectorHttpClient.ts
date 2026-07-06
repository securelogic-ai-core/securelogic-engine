/**
 * connectorHttpClient.ts — EAR Phase 3b: the PRODUCTION HttpClient behind the
 * connector adapters (connectors/types.ts declared "prod uses the SSRF-safe
 * client" — this is it). Every request URL, including operator-configured
 * base_url fields AND fixed SaaS hosts, passes the full A10-G1 webhook SSRF
 * defense: https-only, metadata-hostname blocklist, all-resolved-IPs range
 * classification, then an undici Agent pinned to the validated IP (closes the
 * DNS-rebinding TOCTOU window). Uniform treatment keeps the policy simple and
 * costs nothing for public SaaS endpoints.
 *
 * Responses are size-capped and JSON-parsed; bodies of non-2xx responses are
 * NEVER returned or logged (they can echo credentials). Adapters receive a
 * typed error with status only.
 */

import { fetch as undiciFetch } from "undici";
import { assertSafeWebhookUrl, buildPinnedAgent } from "./webhookUrlSafety.js";
import type { HttpClient } from "./connectors/types.js";

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024; // 10 MB

export class ConnectorHttpError extends Error {
  constructor(public status: number, url: string) {
    super(`connector_http_error: ${status} from ${new URL(url).hostname}`);
    this.name = "ConnectorHttpError";
  }
}

async function request(
  url: string,
  init: { method: "GET" | "POST"; headers: Record<string, string>; body?: string }
): Promise<unknown> {
  const target = await assertSafeWebhookUrl(url);
  const agent = buildPinnedAgent(target.ip, target.family);
  try {
    const res = await undiciFetch(url, {
      method: init.method,
      headers: init.headers,
      ...(init.body !== undefined ? { body: init.body } : {}),
      dispatcher: agent,
      redirect: "error", // a redirect could point at a blocked target — refuse
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    if (!res.ok) throw new ConnectorHttpError(res.status, url);

    const lengthHeader = res.headers.get("content-length");
    if (lengthHeader && Number(lengthHeader) > MAX_RESPONSE_BYTES) {
      throw new Error(`connector_response_too_large: ${lengthHeader} bytes`);
    }
    const text = await res.text();
    if (text.length > MAX_RESPONSE_BYTES) {
      throw new Error(`connector_response_too_large: ${text.length} bytes`);
    }
    return JSON.parse(text) as unknown;
  } finally {
    await agent.close().catch(() => {});
  }
}

/** Build the production HttpClient. A fresh instance per sync run (no shared state). */
export function buildConnectorHttpClient(): HttpClient {
  return {
    getJson(url, headers) {
      return request(url, { method: "GET", headers });
    },
    postForm(url, headers, form) {
      return request(url, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(form).toString()
      });
    },
    postJson(url, headers, body) {
      return request(url, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
    }
  };
}
