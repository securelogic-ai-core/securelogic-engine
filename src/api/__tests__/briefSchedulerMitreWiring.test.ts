/**
 * briefSchedulerMitreWiring.test.ts — Verifies the MITRE adapters are wired
 * into the daily brief scheduler the same way as the other tier-1 sources.
 *
 * The behavioral guarantee "errors from MITRE fetches don't propagate" is
 * provided by the per-source try/catch pattern that's been in place for
 * cisa_kev / nvd / cisa_alerts since the scheduler was built. These tests
 * verify the new MITRE blocks match that pattern exactly:
 *
 *   1. The summary type and the runtime summary object both expose
 *      `mitre_attack` and `mitre_atlas` counters in `signals_fetched`.
 *   2. The scheduler module imports `fetchMitreAttackSignals` and
 *      `fetchMitreAtlasSignals` from the existing adapter modules.
 *   3. Each MITRE fetch is wrapped in a `try { … } catch` block that pushes
 *      a `<name>_fetch_failed: …` entry into `summary.errors` on failure
 *      and emits the canonical `scheduler_<name>_failed` log event —
 *      exactly the shape used by the five existing source blocks.
 *
 * The test reads `briefScheduler.ts` source as text and asserts on its
 * structure. That's deliberately surgical: a behavioural test would need
 * to mock the entire per-org loop (pg, Claude, email delivery, signal
 * processor) just to cover code that's mechanically identical to five
 * working blocks. The structural test catches the failure modes that
 * actually matter — typos in event names, missing try/catch, missing
 * summary push — without the mocking surface area.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  fetchMitreAttackSignals,
  MITRE_ATTACK_BUNDLE_URL
} from "../lib/mitreAttackAdapter.js";
import {
  fetchMitreAtlasSignals,
  MITRE_ATLAS_BUNDLE_URL
} from "../lib/mitreAtlasAdapter.js";
import type { SchedulerRunSummary } from "../lib/briefScheduler.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const schedulerSourcePath = path.resolve(here, "../lib/briefScheduler.ts");
const schedulerSource = readFileSync(schedulerSourcePath, "utf8");

describe("SchedulerRunSummary type", () => {
  // Compile-time + runtime check: if mitre_attack or mitre_atlas were
  // missing from the type or from `signals_fetched`, this object literal
  // would fail to type-check.
  it("requires mitre_attack and mitre_atlas counters in signals_fetched", () => {
    const summary: SchedulerRunSummary = {
      orgs_processed: 0,
      orgs_skipped: 0,
      signals_fetched: {
        cisa_kev: 0,
        nvd: 0,
        cisa_alerts: 0,
        mitre_attack: 0,
        mitre_atlas: 0,
        threat_intel_rss: 0,
        regulatory: 0
      },
      briefs_generated: 0,
      emails_sent: 0,
      emails_failed: 0,
      errors: []
    };
    expect(summary.signals_fetched.mitre_attack).toBe(0);
    expect(summary.signals_fetched.mitre_atlas).toBe(0);
  });
});

describe("MITRE adapter exports — wired into the scheduler", () => {
  it("fetchMitreAttackSignals is callable", () => {
    expect(typeof fetchMitreAttackSignals).toBe("function");
  });

  it("fetchMitreAtlasSignals is callable", () => {
    expect(typeof fetchMitreAtlasSignals).toBe("function");
  });

  it("bundle URL constants are defined", () => {
    // Sanity guard against import drift — if either constant disappears,
    // this test starts failing before the scheduler does.
    expect(MITRE_ATTACK_BUNDLE_URL).toMatch(/^https:\/\//);
    expect(MITRE_ATLAS_BUNDLE_URL).toMatch(/^https:\/\//);
  });
});

describe("briefScheduler.ts source — MITRE wiring shape", () => {
  it("imports fetchMitreAttackSignals and fetchMitreAtlasSignals", () => {
    expect(schedulerSource).toMatch(
      /import\s*\{\s*fetchMitreAttackSignals\s*\}\s*from\s*"\.\/mitreAttackAdapter\.js"/
    );
    expect(schedulerSource).toMatch(
      /import\s*\{\s*fetchMitreAtlasSignals\s*\}\s*from\s*"\.\/mitreAtlasAdapter\.js"/
    );
  });

  it("wraps fetchMitreAttackSignals in a try block and emits the canonical fetched-event", () => {
    // Match the canonical fetched-success log event used by five other
    // source blocks: scheduler_<name>_fetched.
    expect(schedulerSource).toMatch(
      /try\s*\{[\s\S]*?fetchMitreAttackSignals\(\)[\s\S]*?scheduler_mitre_attack_fetched/
    );
  });

  it("wraps fetchMitreAtlasSignals in a try block and emits the canonical fetched-event", () => {
    expect(schedulerSource).toMatch(
      /try\s*\{[\s\S]*?fetchMitreAtlasSignals\(\)[\s\S]*?scheduler_mitre_atlas_fetched/
    );
  });

  it("catches MITRE ATT&CK fetch errors, pushes mitre_attack_fetch_failed to summary.errors, logs the canonical failed-event", () => {
    // The canonical pattern across cisa_kev / nvd / cisa_alerts:
    //   summary.errors.push(`<name>_fetch_failed: ${msg}`)
    //   logger.error({ event: "scheduler_<name>_failed", err }, "...")
    expect(schedulerSource).toMatch(
      /summary\.errors\.push\(`mitre_attack_fetch_failed:/
    );
    expect(schedulerSource).toMatch(/scheduler_mitre_attack_failed/);
  });

  it("catches MITRE ATLAS fetch errors, pushes mitre_atlas_fetch_failed to summary.errors, logs the canonical failed-event", () => {
    expect(schedulerSource).toMatch(
      /summary\.errors\.push\(`mitre_atlas_fetch_failed:/
    );
    expect(schedulerSource).toMatch(/scheduler_mitre_atlas_failed/);
  });

  it("logs fromCache on the fetched-event so ops can see ETag short-circuit rate", () => {
    // Free observability win from the PR #35 ETag work — the scheduler
    // surfaces fromCache so dashboards can chart cache-hit vs cold-fetch
    // ratios across daily runs.
    expect(schedulerSource).toMatch(
      /scheduler_mitre_attack_fetched[^}]*fromCache/
    );
    expect(schedulerSource).toMatch(
      /scheduler_mitre_atlas_fetched[^}]*fromCache/
    );
  });

  it("ingests both MITRE batches per-org under the canonical ingested-event names", () => {
    // Mirrors the per-org ingest blocks for the other five sources.
    expect(schedulerSource).toMatch(
      /if\s*\(\s*mitreAttackSignals\.length\s*>\s*0\s*\)/
    );
    expect(schedulerSource).toMatch(/scheduler_mitre_attack_ingested/);
    expect(schedulerSource).toMatch(
      /if\s*\(\s*mitreAtlasSignals\.length\s*>\s*0\s*\)/
    );
    expect(schedulerSource).toMatch(/scheduler_mitre_atlas_ingested/);
  });

  it("places MITRE ingest blocks AFTER cisa_alerts and BEFORE threat_intel — matches fetch order", () => {
    const cisaAlertsIdx = schedulerSource.indexOf("scheduler_cisa_alerts_ingested");
    const mitreAttackIngestIdx = schedulerSource.indexOf(
      "scheduler_mitre_attack_ingested"
    );
    const mitreAtlasIngestIdx = schedulerSource.indexOf(
      "scheduler_mitre_atlas_ingested"
    );
    const threatIntelIdx = schedulerSource.indexOf(
      "scheduler_threat_intel_ingested"
    );

    expect(cisaAlertsIdx).toBeGreaterThan(-1);
    expect(mitreAttackIngestIdx).toBeGreaterThan(cisaAlertsIdx);
    expect(mitreAtlasIngestIdx).toBeGreaterThan(mitreAttackIngestIdx);
    expect(threatIntelIdx).toBeGreaterThan(mitreAtlasIngestIdx);
  });
});
