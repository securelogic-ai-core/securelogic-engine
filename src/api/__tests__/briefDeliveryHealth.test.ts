/**
 * briefDeliveryHealth.test.ts — precedence + classification tests for the pure
 * delivery-health evaluator that turns a silent zero-delivery Brief run into an
 * operator alert.
 */

import { describe, it, expect } from "vitest";
import { evaluateDeliveryHealth } from "../lib/briefDeliveryHealth.js";
import type { SchedulerRunSummary } from "../lib/briefScheduler.js";

function mkSummary(partial: Partial<SchedulerRunSummary> = {}): SchedulerRunSummary {
  return {
    orgs_processed: 0,
    orgs_skipped: 0,
    signals_fetched: {
      cisa_kev: 0,
      nvd: 0,
      sec_edgar: 0,
      federal_register: 0,
      cisa_alerts: 0,
      mitre_attack: 0,
      mitre_atlas: 0,
      threat_intel_rss: 0,
      regulatory: 0
    },
    briefs_generated: 0,
    emails_sent: 0,
    emails_failed: 0,
    emails_skipped_off_day: 0,
    errors: [],
    ...partial
  };
}

describe("evaluateDeliveryHealth", () => {
  it("is OK on a non-send-day regardless of counts (generation-only run)", () => {
    const health = evaluateDeliveryHealth(
      mkSummary({ orgs_processed: 3, briefs_generated: 3, emails_sent: 0, emails_skipped_off_day: 3 }),
      false
    );
    expect(health.severity).toBe("ok");
  });

  it("is OK on a send-day when emails were delivered with no failures", () => {
    const health = evaluateDeliveryHealth(
      mkSummary({ orgs_processed: 2, briefs_generated: 2, emails_sent: 5, emails_failed: 0 }),
      true
    );
    expect(health.severity).toBe("ok");
    expect(health.reason).toBe("");
  });

  it("errors when the orgs query failed (takes precedence over everything)", () => {
    const health = evaluateDeliveryHealth(
      mkSummary({ errors: ["orgs_query_failed: connection reset"] }),
      true
    );
    expect(health.severity).toBe("error");
    expect(health.reason).toBe("orgs_query_failed");
  });

  it("errors on any send failure (the common Resend/env break)", () => {
    const health = evaluateDeliveryHealth(
      mkSummary({ orgs_processed: 1, briefs_generated: 1, emails_sent: 2, emails_failed: 3 }),
      true
    );
    expect(health.severity).toBe("error");
    expect(health.reason).toBe("send_failures");
    expect(health.message).toContain("3 failed send");
  });

  it("errors when briefs generated but zero delivered (all filtered/suppressed/already-sent)", () => {
    const health = evaluateDeliveryHealth(
      mkSummary({ orgs_processed: 2, briefs_generated: 2, emails_sent: 0, emails_failed: 0 }),
      true
    );
    expect(health.severity).toBe("error");
    expect(health.reason).toBe("generated_but_no_delivery");
  });

  it("errors when every org failed generation", () => {
    const health = evaluateDeliveryHealth(
      mkSummary({ orgs_processed: 0, orgs_skipped: 2, briefs_generated: 0 }),
      true
    );
    expect(health.severity).toBe("error");
    expect(health.reason).toBe("all_generation_failed");
  });

  it("warns (not errors) when no org has active subscribers on a send day", () => {
    const health = evaluateDeliveryHealth(
      mkSummary({ orgs_processed: 0, orgs_skipped: 0, briefs_generated: 0 }),
      true
    );
    expect(health.severity).toBe("warn");
    expect(health.reason).toBe("no_active_subscribers");
  });

  it("prioritizes send_failures over generated_but_no_delivery", () => {
    // 0 sent AND failures present — the failure reason is the actionable one.
    const health = evaluateDeliveryHealth(
      mkSummary({ orgs_processed: 1, briefs_generated: 1, emails_sent: 0, emails_failed: 4 }),
      true
    );
    expect(health.reason).toBe("send_failures");
  });
});
