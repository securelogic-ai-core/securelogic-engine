/**
 * eventNotificationPolicy.test.ts — Intelligence Pipeline Hardening / IE.P7.
 *
 * Pins the notification policy: immediate ONLY for customer-impacting critical /
 * exploited events, digest for other customer-impacting events, none otherwise.
 */

import { describe, it, expect } from "vitest";
import { decideNotification } from "../../lib/signals/eventNotificationPolicy.js";

describe("decideNotification", () => {
  it("never notifies for events that don't impact the org", () => {
    expect(decideNotification({ severity: "Critical", status: "exploited", customerImpacting: false }).channel).toBe("none");
  });

  it("sends immediate for a customer-impacting critical event", () => {
    const d = decideNotification({ severity: "Critical", status: "new", customerImpacting: true });
    expect(d.channel).toBe("immediate");
    expect(d.reason).toBe("customer_impacting_critical");
  });

  it("sends immediate for a customer-impacting exploited event even below Critical", () => {
    const d = decideNotification({ severity: "High", status: "exploited", customerImpacting: true });
    expect(d.channel).toBe("immediate");
    expect(d.reason).toBe("customer_impacting_exploited");
  });

  it("rolls other customer-impacting events into the daily digest", () => {
    expect(decideNotification({ severity: "High", status: "evolving", customerImpacting: true }).channel).toBe("digest");
    expect(decideNotification({ severity: "Moderate", status: "new", customerImpacting: true }).channel).toBe("digest");
    expect(decideNotification({ severity: "Low", status: "patched", customerImpacting: true }).channel).toBe("digest");
  });
});
