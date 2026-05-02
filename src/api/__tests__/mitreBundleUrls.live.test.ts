/**
 * mitreBundleUrls.live.test.ts — Live-network smoke test for the MITRE
 * bundle URLs.
 *
 * Gated on the MITRE_SMOKE_TEST=1 env var so the default `npm test` run
 * stays hermetic and never depends on upstream availability. Run manually
 * before deploys, or in a periodic ops job, to catch the next time MITRE
 * moves a bundle (this PR exists because the ATLAS bundle moved from
 * `mitre-atlas/atlas-data` to `mitre-atlas/atlas-navigator-data` without
 * notice).
 *
 * Usage:
 *   MITRE_SMOKE_TEST=1 npx vitest run src/api/__tests__/mitreBundleUrls.live.test.ts
 *
 * The test issues a HEAD request to each bundle URL and asserts 200.
 * GitHub raw blobs return ETags on HEAD (verified manually 2026-05-02), so
 * the assertion also surfaces the current ETag for visual sanity-checking.
 */

import { describe, it, expect } from "vitest";
import { MITRE_ATTACK_BUNDLE_URL } from "../lib/mitreAttackAdapter.js";
import { MITRE_ATLAS_BUNDLE_URL } from "../lib/mitreAtlasAdapter.js";

const SMOKE_ENABLED = process.env.MITRE_SMOKE_TEST === "1";

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
        "User-Agent": "SecureLogic-AI/1.0 (MITRE Bundle URL Smoke Test)"
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

describe.runIf(SMOKE_ENABLED)("MITRE bundle URLs — live smoke test", () => {
  it("MITRE_ATTACK_BUNDLE_URL returns 200 with an ETag header", async () => {
    const { status, etag } = await probeHead(MITRE_ATTACK_BUNDLE_URL);
    expect(status, `unexpected status from ${MITRE_ATTACK_BUNDLE_URL}`).toBe(200);
    expect(etag, "GitHub raw blobs are expected to return ETag on HEAD").toBeTruthy();
  });

  it("MITRE_ATLAS_BUNDLE_URL returns 200 with an ETag header", async () => {
    const { status, etag } = await probeHead(MITRE_ATLAS_BUNDLE_URL);
    expect(status, `unexpected status from ${MITRE_ATLAS_BUNDLE_URL}`).toBe(200);
    expect(etag, "GitHub raw blobs are expected to return ETag on HEAD").toBeTruthy();
  });
});

// Sanity assertion that runs in the default suite even when the smoke test
// is gated off — guards against typo regressions on the URL constants.
describe("MITRE bundle URL constants — shape", () => {
  it("ATT&CK URL points at raw.githubusercontent.com/mitre/cti", () => {
    expect(MITRE_ATTACK_BUNDLE_URL).toMatch(
      /^https:\/\/raw\.githubusercontent\.com\/mitre\/cti\//
    );
    expect(MITRE_ATTACK_BUNDLE_URL).toMatch(/enterprise-attack\.json$/);
  });

  it("ATLAS URL points at raw.githubusercontent.com/mitre-atlas/atlas-navigator-data", () => {
    expect(MITRE_ATLAS_BUNDLE_URL).toMatch(
      /^https:\/\/raw\.githubusercontent\.com\/mitre-atlas\/atlas-navigator-data\//
    );
    expect(MITRE_ATLAS_BUNDLE_URL).toMatch(/stix-atlas\.json$/);
  });
});
