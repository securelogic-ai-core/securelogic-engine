/**
 * briefDeliveryHealth.test.ts — precedence + classification tests for the pure
 * delivery-health evaluator.
 *
 * Encodes the ratified product model (ADR-0007): brief generation is an
 * organizational entitlement of every active org; email delivery is a separate
 * capability. Zero briefs generated while active orgs exist is an ERROR
 * (operational failure); zero email recipients is a WARN (delivery-health
 * condition — the in-platform brief is still current).
 */

import { describe, it, expect } from "vitest";
import { evaluateDeliveryHealth } from "../lib/briefDeliveryHealth.js";
import type { SchedulerRunSummary } from "../lib/briefScheduler.js";

function mkSummary(partial: Partial<SchedulerRunSummary> = {}): SchedulerRunSummary {
  return {
    active_orgs: 0,
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
    emails_skipped_no_recipients: 0,
    orgs_without_recipients: [],
    errors: [],
    ...partial
  };
}

describe("evaluateDeliveryHealth", () => {
  it("is OK on a non-send-day when generation succeeded (generation-only run)", () => {
    const health = evaluateDeliveryHealth(
      mkSummary({ active_orgs: 3, orgs_processed: 3, briefs_generated: 3, emails_sent: 0, emails_skipped_off_day: 3 }),
      false
    );
    expect(health.severity).toBe("ok");
  });

  it("is OK on a send-day when emails were delivered with no failures", () => {
    const health = evaluateDeliveryHealth(
      mkSummary({ active_orgs: 2, orgs_processed: 2, briefs_generated: 2, emails_sent: 5, emails_failed: 0 }),
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

  it("errors when active orgs exist but zero briefs were generated (operational failure)", () => {
    const health = evaluateDeliveryHealth(
      mkSummary({ active_orgs: 4, briefs_generated: 0 }),
      true
    );
    expect(health.severity).toBe("error");
    expect(health.reason).toBe("no_briefs_generated");
  });

  it("treats zero generation with active orgs as an error even on a non-send day", () => {
    // Off-day runs still generate; a run that produced nothing for active
    // customers is an operational failure regardless of the email calendar.
    const health = evaluateDeliveryHealth(
      mkSummary({ active_orgs: 4, briefs_generated: 0 }),
      false
    );
    expect(health.severity).toBe("error");
    expect(health.reason).toBe("no_briefs_generated");
  });

  it("errors when every org failed generation", () => {
    const health = evaluateDeliveryHealth(
      mkSummary({ active_orgs: 2, orgs_processed: 0, orgs_skipped: 2, briefs_generated: 0 }),
      true
    );
    expect(health.severity).toBe("error");
    expect(health.reason).toBe("all_generation_failed");
  });

  it("errors on any send failure (the common Resend/env break)", () => {
    const health = evaluateDeliveryHealth(
      mkSummary({ active_orgs: 1, orgs_processed: 1, briefs_generated: 1, emails_sent: 2, emails_failed: 3 }),
      true
    );
    expect(health.severity).toBe("error");
    expect(health.reason).toBe("send_failures");
    expect(health.message).toContain("3 failed send");
  });

  it("warns (not errors) when briefs were generated but every org has zero recipients", () => {
    const health = evaluateDeliveryHealth(
      mkSummary({
        active_orgs: 2,
        orgs_processed: 2,
        briefs_generated: 2,
        emails_sent: 0,
        emails_skipped_no_recipients: 2,
        orgs_without_recipients: ["org-a", "org-b"]
      }),
      true
    );
    expect(health.severity).toBe("warn");
    expect(health.reason).toBe("no_recipients_configured");
    expect(health.message).toContain("In-platform briefs are current");
  });

  it("errors when briefs generated, recipients existed, but zero delivered (all filtered/suppressed/already-sent)", () => {
    const health = evaluateDeliveryHealth(
      mkSummary({ active_orgs: 2, orgs_processed: 2, briefs_generated: 2, emails_sent: 0, emails_failed: 0 }),
      true
    );
    expect(health.severity).toBe("error");
    expect(health.reason).toBe("generated_but_no_delivery");
  });

  it("warns when the platform has no active orgs at all on a send day", () => {
    const health = evaluateDeliveryHealth(
      mkSummary({ active_orgs: 0, briefs_generated: 0 }),
      true
    );
    expect(health.severity).toBe("warn");
    expect(health.reason).toBe("no_active_orgs");
  });

  it("warns with the recurring delivery-coverage report when some (not all) orgs have zero recipients", () => {
    const health = evaluateDeliveryHealth(
      mkSummary({
        active_orgs: 3,
        orgs_processed: 3,
        briefs_generated: 3,
        emails_sent: 4,
        emails_skipped_no_recipients: 1,
        orgs_without_recipients: ["org-uncovered"]
      }),
      true
    );
    expect(health.severity).toBe("warn");
    expect(health.reason).toBe("orgs_without_recipients");
    expect(health.message).toContain("org-uncovered");
  });

  it("prioritizes send_failures over generated_but_no_delivery", () => {
    // 0 sent AND failures present — the failure reason is the actionable one.
    const health = evaluateDeliveryHealth(
      mkSummary({ active_orgs: 1, orgs_processed: 1, briefs_generated: 1, emails_sent: 0, emails_failed: 4 }),
      true
    );
    expect(health.reason).toBe("send_failures");
  });

  it("prioritizes no_briefs_generated over recipient-level verdicts", () => {
    const health = evaluateDeliveryHealth(
      mkSummary({
        active_orgs: 2,
        briefs_generated: 0,
        orgs_without_recipients: ["org-a"]
      }),
      true
    );
    expect(health.reason).toBe("no_briefs_generated");
    expect(health.severity).toBe("error");
  });
});
