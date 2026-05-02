/**
 * cisaKevUrl.live.test.ts — Live-network smoke test for the CISA KEV catalog URL.
 *
 * Mirrors mitreBundleUrls.live.test.ts. Gated on `KEV_SMOKE_TEST=1` so the
 * default `npm test` run stays hermetic and never depends on cisa.gov
 * availability. Run manually before deploys, or in a periodic ops job, to
 * catch the next time CISA reorganizes the feed (the MITRE ATLAS URL
 * silently moved between repos in early 2026 — exactly the failure mode
 * this test exists to surface for KEV).
 *
 * Usage:
 *   KEV_SMOKE_TEST=1 npx vitest run src/api/__tests__/cisaKevUrl.live.test.ts
 *
 * The test issues a HEAD request to the catalog URL and asserts 200. CISA
 * returns ETag headers on this resource (verified manually against the
 * production feed), so the assertion also surfaces the current ETag for
 * visual sanity-checking.
 */

import { describe, it, expect } from "vitest";
import { CISA_KEV_FEED_URL } from "../lib/cisaKevAdapter.js";

const SMOKE_ENABLED = process.env.KEV_SMOKE_TEST === "1";

const HEAD_TIMEOUT_MS = 10_000;

async function probeHead(
  url: string
): Promise<{ status: number; etag: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEAD_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      headers: {
        "User-Agent": "SecureLogic-AI/1.0 (CISA KEV URL Smoke Test)"
      }
    });
    return {
      status: response.status,
      etag: response.headers.get("etag")
    };
  } finally {
    clearTimeout(timer);
  }
}

describe.runIf(SMOKE_ENABLED)("CISA KEV URL — live smoke test", () => {
  it("CISA_KEV_FEED_URL returns 200 with an ETag header", async () => {
    const { status, etag } = await probeHead(CISA_KEV_FEED_URL);
    expect(status, `unexpected status from ${CISA_KEV_FEED_URL}`).toBe(200);
    expect(
      etag,
      "cisa.gov is expected to return ETag on HEAD — conditional GET depends on it"
    ).toBeTruthy();
  });
});

// Sanity assertion that runs in the default suite even when the smoke test
// is gated off — guards against typo regressions on the URL constant.
describe("CISA KEV URL constant — shape", () => {
  it("points at cisa.gov known_exploited_vulnerabilities.json", () => {
    expect(CISA_KEV_FEED_URL).toMatch(
      /^https:\/\/www\.cisa\.gov\/sites\/default\/files\/feeds\//
    );
    expect(CISA_KEV_FEED_URL).toMatch(/known_exploited_vulnerabilities\.json$/);
  });
});
