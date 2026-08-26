/**
 * exceptionStatus.test.ts — SL-EXC-1, the wording rules.
 *
 * The package exists because the platform could previously say only "overdue"
 * or "closed" about a finding, so recording an exception CLOSED it — asserting
 * remediation was done at the exact moment someone said they could not finish
 * in time. These tests pin the replacement: several facts stated at once, none
 * of them dropped, and never a word that implies the requirement was satisfied.
 */
import { describe, it, expect } from "vitest";

import {
  summariseException,
  SLA_POSTURE_LABEL,
  EXCEPTION_STATE_LABEL,
  type ExceptionInput,
} from "../exceptionStatus";

const NOW = new Date("2026-10-01T00:00:00.000Z");
const OVERDUE = { due_date: "2026-09-20", operational_status: "in_progress" };
const FUTURE = { due_date: "2026-12-01", operational_status: "in_progress" };

const exc = (over: Partial<ExceptionInput> = {}): ExceptionInput => ({
  state: "approved", kind: "exception", expires_at: "2026-10-15",
  compensating_control: "WAF virtual patch", sla_due_date_at_request: "2026-09-20", ...over,
});

describe("no exception", () => {
  it("an overdue finding with none says exactly that", () => {
    const s = summariseException(OVERDUE, [], NOW);

    expect(s.exceptionState).toBe("none");
    expect(s.slaPosture).toBe("overdue_no_exception");
  });

  it("a finding inside its SLA is within SLA", () => {
    expect(summariseException(FUTURE, [], NOW).slaPosture).toBe("within_sla");
  });

  it("a finding with no due date is not called overdue", () => {
    expect(summariseException({ due_date: null }, [], NOW).slaPosture).toBe("no_due_date");
  });
});

describe("an approved exception is stated, not hidden", () => {
  it("distinguishes overdue-with-exception from plain overdue", () => {
    // The distinction the audit demanded. Both are overdue; only one is
    // authorised, and a customer must see which at a glance.
    const s = summariseException(OVERDUE, [exc()], NOW);

    expect(s.slaPosture).toBe("overdue_exception_approved");
    expect(s.exceptionState).toBe("approved");
  });

  it("keeps the ORIGINAL due date and the exception expiry as separate facts", () => {
    const s = summariseException(OVERDUE, [exc()], NOW);

    expect(s.originalDueDate).toBe("2026-09-20");      // what was required
    expect(s.exceptionExpiresAt).toBe("2026-10-15");   // what was authorised
  });

  it("surfaces the compensating control", () => {
    expect(summariseException(OVERDUE, [exc()], NOW).compensatingControl).toBe("WAF virtual patch");
  });

  it("still reports remediation as OUTSTANDING", () => {
    // The core assertion: an exception authorises the delay, it does not
    // satisfy the requirement.
    expect(summariseException(OVERDUE, [exc()], NOW).remediationOutstanding).toBe(true);
  });

  it("never uses a word implying the requirement was met", () => {
    const label = SLA_POSTURE_LABEL[summariseException(OVERDUE, [exc()], NOW).slaPosture];

    expect(label).toMatch(/Overdue/);
    for (const forbidden of [/remediated/i, /closed/i, /compliant/i, /resolved/i]) {
      expect(label).not.toMatch(forbidden);
    }
  });

  it("no posture label anywhere claims compliance for an exception", () => {
    for (const [posture, label] of Object.entries(SLA_POSTURE_LABEL)) {
      if (posture.includes("exception")) {
        expect(label, posture).not.toMatch(/compliant|remediated|closed/i);
      }
    }
  });
});

describe("expiry is truthful without a sweep", () => {
  it("an approved exception past its date reads as EXPIRED", () => {
    // Even while the stored state is still 'approved'. A customer's posture
    // must not depend on whether the expiry worker ran this morning.
    const s = summariseException(OVERDUE, [exc({ expires_at: "2026-09-25" })], NOW);

    expect(s.exceptionState).toBe("expired");
    expect(s.slaPosture).toBe("overdue_exception_expired");
  });

  it("an exception expiring today is still in force", () => {
    expect(summariseException(OVERDUE, [exc({ expires_at: "2026-10-01" })], NOW).exceptionState)
      .toBe("approved");
  });
});

describe("the other states", () => {
  it("a pending request is shown as requested, not approved", () => {
    const s = summariseException(OVERDUE, [exc({ state: "proposed" })], NOW);

    expect(s.exceptionState).toBe("pending");
    expect(s.slaPosture).toBe("overdue_exception_pending");
  });

  it("a rejected exception leaves the finding plainly overdue", () => {
    const s = summariseException(OVERDUE, [exc({ state: "rejected" })], NOW);

    expect(s.exceptionState).toBe("rejected");
    expect(s.slaPosture).toBe("overdue_no_exception");
  });

  it("a withdrawn exception does the same", () => {
    expect(summariseException(OVERDUE, [exc({ state: "withdrawn" })], NOW).slaPosture)
      .toBe("overdue_no_exception");
  });

  it("an approved exception outranks an older rejected one", () => {
    const s = summariseException(OVERDUE, [exc({ state: "rejected" }), exc()], NOW);

    expect(s.exceptionState).toBe("approved");
  });
});

describe("acceptances are a different decision and are not summarised here", () => {
  it("an approved ACCEPTANCE does not register as an exception", () => {
    const s = summariseException(OVERDUE, [exc({ kind: "acceptance" })], NOW);

    expect(s.exceptionState).toBe("none");
    expect(s.slaPosture).toBe("overdue_no_exception");
  });

  it("a row with no kind is read as an acceptance — every historical row is one", () => {
    const s = summariseException(OVERDUE, [exc({ kind: undefined })], NOW);

    expect(s.exceptionState).toBe("none");
  });
});

describe("a genuinely closed finding", () => {
  it("reports remediation as no longer outstanding", () => {
    const s = summariseException(
      { due_date: "2026-09-20", operational_status: "closed" }, [], NOW);

    expect(s.remediationOutstanding).toBe(false);
  });
});

describe("labels", () => {
  it("every state and posture has customer-facing wording", () => {
    for (const v of Object.values(EXCEPTION_STATE_LABEL)) expect(v.length).toBeGreaterThan(0);
    for (const v of Object.values(SLA_POSTURE_LABEL)) expect(v.length).toBeGreaterThan(0);
  });
});
