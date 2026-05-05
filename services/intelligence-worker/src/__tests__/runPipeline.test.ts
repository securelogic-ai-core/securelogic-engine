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

const here = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(here, "../pipeline/runPipeline.ts");
const source = readFileSync(sourcePath, "utf8");

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
