/**
 * runPipeline.test.ts — focused coverage for the matcher fan-out added to
 * runPipeline.ts in package 3.5. The pipeline does many things (fetch
 * feeds, score signals, save insights, generate trends, etc.); this file
 * only covers the bridge → fan-out path because that's what the package
 * changed. Other parts of the pipeline are exercised elsewhere.
 *
 * STRUCTURAL TESTS (runPipeline.ts source)
 * ----------------------------------------
 * Mirror the kevPoller.test.ts pattern. Catches drift in:
 *   - import of runMatcherForSignal from cyberSignalProcessingService
 *   - presence of fanOutMatcherToActiveOrgs as a private function
 *   - the active-orgs query shape (status='active', ORDER BY id)
 *   - per-pair try/catch wrapping runMatcherForSignal
 *
 * Behavioural tests for the bridge+fan-out interaction would require
 * mocking the entire feed-fetch and scoring layers — too much surface for
 * this package. We rely on:
 *   - cyberSignalProcessingService.test.ts to verify runMatcherForSignal
 *   - kevPoller.test.ts to exercise the fan-out invocation pattern
 *     (same shape used in runPipeline; the pattern is shared)
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { buildDedupHash } from "../../../../src/api/lib/cyberSignalNormalizer.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(here, "../pipeline/runPipeline.ts");
const source = readFileSync(sourcePath, "utf8");

/**
 * Reproduces the LEGACY inline bridge hash that runPipeline.ts used before the
 * dedup-collapse fix: sha256(source|signal_type|cve|vendor), lowercased. Kept
 * here only to demonstrate the collapse the fix removes — it is NOT imported
 * from source (the inline impl was deleted).
 */
function legacyBridgeHash(
  source: string,
  signalType: string,
  cve: string | null,
  vendor: string | null
): string {
  const input = `${source}|${signalType}|${cve ?? ""}|${vendor ?? ""}`.toLowerCase();
  return createHash("sha256").update(input).digest("hex");
}

/**
 * The discriminator the post-fix bridge feeds to buildDedupHash as external_id:
 * the RSS item URL, falling back to the title when the item has no URL.
 * Mirrors `const externalId = signal.url ?? signal.title;` in runPipeline.ts.
 */
function bridgeExternalId(url: string | null, title: string): string {
  return url ?? title;
}

describe("runPipeline.ts source — matcher fan-out wiring", () => {
  it("imports runMatcherForSignal from cyberSignalProcessingService", () => {
    expect(source).toMatch(
      /import\s*\{[\s\S]*?runMatcherForSignal[\s\S]*?\}\s*from\s*"\.\.\/\.\.\/\.\.\/\.\.\/src\/api\/lib\/cyberSignalProcessingService\.js"/
    );
  });

  it("imports CyberSignalRecord type from the same module", () => {
    expect(source).toMatch(
      /import\s*\{[\s\S]*?type CyberSignalRecord[\s\S]*?\}\s*from\s*"\.\.\/\.\.\/\.\.\/\.\.\/src\/api\/lib\/cyberSignalProcessingService\.js"/
    );
  });

  it("declares a fanOutMatcherToActiveOrgs helper", () => {
    expect(source).toMatch(/async function fanOutMatcherToActiveOrgs/);
  });

  it("active-orgs query filters status='active' and orders by id", () => {
    expect(source).toMatch(
      /SELECT id FROM organizations\s+WHERE status = 'active'\s+ORDER BY id/
    );
  });

  it("calls fanOutMatcherToActiveOrgs after bridgeSignalsToCyberSignals using the inserted IDs", () => {
    // bridgeSignalsToCyberSignals returns insertedSignals; fanOut consumes them.
    expect(source).toMatch(/bridgeResult\.insertedSignals/);
    expect(source).toMatch(/fanOutMatcherToActiveOrgs\(bridgeResult\.insertedSignals\)/);
  });

  it("wraps each (signal, org) pair in try/catch (no single-pair failure aborts the cycle)", () => {
    // The fan-out body has two nested for-loops (signals × orgs), with
    // an inner try/catch wrapping runMatcherForSignal. We check that the
    // try block contains the runMatcherForSignal call and a catch block
    // follows that logs matcher_fanout_pair_failed.
    expect(source).toMatch(
      /for \(const signal of signals\)[\s\S]*?for \(const org of activeOrgs\)[\s\S]*?try\s*\{[\s\S]*?runMatcherForSignal\(signal, org\.id\)[\s\S]*?\}\s*catch[\s\S]*?matcher_fanout_pair_failed/
    );
  });

  it("logs aggregate metrics at end of fan-out cycle", () => {
    expect(source).toMatch(/event:\s*"matcher_fanout_complete"/);
    expect(source).toMatch(/pairsAttempted/);
    expect(source).toMatch(/pairsSucceeded/);
    expect(source).toMatch(/pairsFailed/);
    expect(source).toMatch(/matchesProduced/);
    expect(source).toMatch(/elapsedMs/);
  });

  it("active-orgs query failure logs and skips the fan-out cycle (does not propagate)", () => {
    expect(source).toMatch(/matcher_fanout_orgs_query_failed/);
  });

  it("0 active orgs is a no-op (logs, returns early)", () => {
    expect(source).toMatch(/matcher_fanout_no_active_orgs/);
  });

  it("bridgeSignalsToCyberSignals returns insertedSignals as CyberSignalRecord[]", () => {
    // Key signature change for the package: bridge returns inserted IDs
    // so the fan-out can iterate them. Without this, the fan-out cannot
    // know which signals are new this cycle vs duplicates.
    expect(source).toMatch(
      /async function bridgeSignalsToCyberSignals\([\s\S]*?\):\s*Promise<\{[\s\S]*?insertedSignals:\s*CyberSignalRecord\[\][\s\S]*?\}>/
    );
  });

  it("fan-out invocation is wrapped in try/catch at the call site (broad safety net)", () => {
    // Belt-and-suspenders: in case fanOutMatcherToActiveOrgs itself
    // throws unexpectedly (its own internals already swallow per-pair
    // and orgs-query errors, but a programmer error could still escape),
    // the call site catches and logs without aborting the pipeline.
    expect(source).toMatch(/matcher_fanout_unexpected_error/);
  });
});

describe("runPipeline.ts source — dedup-collapse fix wiring", () => {
  it("imports the canonical buildDedupHash (no second hash impl)", () => {
    expect(source).toMatch(
      /import\s*\{\s*buildDedupHash\s*\}\s*from\s*"\.\.\/\.\.\/\.\.\/\.\.\/src\/api\/lib\/cyberSignalNormalizer\.js"/
    );
  });

  it("no longer computes an inline sha256 dedup hash", () => {
    expect(source).not.toMatch(/createHash\(\s*"sha256"\s*\)/);
    expect(source).not.toMatch(/import\s+crypto\s+from\s+"crypto"/);
  });

  it("BridgeableSignal carries a url discriminator", () => {
    expect(source).toMatch(/type BridgeableSignal = \{[\s\S]*?url:\s*string \| null;[\s\S]*?\}/);
  });

  it("derives the dedup external_id as url ?? title", () => {
    expect(source).toMatch(/const externalId = signal\.url \?\? signal\.title;/);
  });

  it("passes externalId to buildDedupHash with the canonical arg order", () => {
    expect(source).toMatch(
      /buildDedupHash\(\s*signal\.source,\s*signalType,\s*signal\.affectedCve,\s*signal\.affectedVendor,\s*externalId\s*\)/
    );
  });

  it("the bridge INSERT writes the external_id column", () => {
    // external_id must be persisted so a future orphan-cleanup can rely on
    // the same external_id-IS-NULL safety predicate the normalizer path uses.
    expect(source).toMatch(/INSERT INTO cyber_signals \([\s\S]*?external_id,[\s\S]*?dedup_hash,/);
  });

  it("the push site forwards signal.url into the bridgeable record", () => {
    expect(source).toMatch(/url:\s*signal\.url \?\? null,/);
  });
});

describe("bridge dedup behaviour — collapse is fixed", () => {
  // The defining case: vendorless + CVE-less regulatory/news items from the
  // SAME source and signal_type. Under the legacy key these all collapsed to a
  // single stored row, starving the matcher fan-out.
  const feedSource = "regulatory_nist";
  const signalType = "regulatory_change";

  it("two items differing ONLY by url now produce two distinct dedup_hashes (legacy collapsed them to one)", () => {
    const a = { url: "https://nist.gov/news/item-a", title: "NIST update", cve: null, vendor: null };
    const b = { url: "https://nist.gov/news/item-b", title: "NIST update", cve: null, vendor: null };

    // Legacy: identical key → SAME hash → second item suppressed by ON CONFLICT.
    expect(legacyBridgeHash(feedSource, signalType, a.cve, a.vendor)).toBe(
      legacyBridgeHash(feedSource, signalType, b.cve, b.vendor)
    );

    // Post-fix: url is the discriminator → DISTINCT hashes → both rows stored.
    const hashA = buildDedupHash(feedSource, signalType, a.cve, a.vendor, bridgeExternalId(a.url, a.title));
    const hashB = buildDedupHash(feedSource, signalType, b.cve, b.vendor, bridgeExternalId(b.url, b.title));
    expect(hashA).not.toBe(hashB);
  });

  it("two url-less items differing ONLY by title produce distinct hashes (title fallback prevents collapse)", () => {
    const a = { url: null, title: "FTC fines Acme Corp", cve: null, vendor: null };
    const b = { url: null, title: "FTC issues privacy guidance", cve: null, vendor: null };

    // Legacy still collapses (no cve, no vendor, same source/type).
    expect(legacyBridgeHash(feedSource, signalType, a.cve, a.vendor)).toBe(
      legacyBridgeHash(feedSource, signalType, b.cve, b.vendor)
    );

    // Post-fix: title is the fallback discriminator → distinct hashes.
    const hashA = buildDedupHash(feedSource, signalType, a.cve, a.vendor, bridgeExternalId(a.url, a.title));
    const hashB = buildDedupHash(feedSource, signalType, b.cve, b.vendor, bridgeExternalId(b.url, b.title));
    expect(hashA).not.toBe(hashB);
  });

  it("a genuine duplicate (same url) still dedups to one hash (no over-splitting)", () => {
    const hashA = buildDedupHash(feedSource, signalType, null, null, bridgeExternalId("https://nist.gov/news/x", "T"));
    const hashB = buildDedupHash(feedSource, signalType, null, null, bridgeExternalId("https://nist.gov/news/x", "T-different-title"));
    // url wins over title, so the same url is still a duplicate → ON CONFLICT suppresses.
    expect(hashA).toBe(hashB);
  });

  it("CVE-bearing items (KEV/NVD-style) are unaffected: url is preferred but cve-only items still distinguish by cve", () => {
    // A bridge item that happens to carry a CVE and no url falls back to title;
    // two different CVEs with different titles remain distinct either way.
    const hashA = buildDedupHash("regulatory_cisa", signalType, "CVE-2026-0001", null, bridgeExternalId(null, "A"));
    const hashB = buildDedupHash("regulatory_cisa", signalType, "CVE-2026-0002", null, bridgeExternalId(null, "B"));
    expect(hashA).not.toBe(hashB);
  });
});
