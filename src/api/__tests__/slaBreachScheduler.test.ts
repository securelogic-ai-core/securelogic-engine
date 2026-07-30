import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockPgQuery, mockElevatedQuery, mockWithTenant, mockIsSuppressed, mockIsDuplicate, mockRecordSend, mockSend } =
  vi.hoisted(() => ({
    mockPgQuery: vi.fn(),
    mockElevatedQuery: vi.fn(),
    mockWithTenant: vi.fn(async (_orgId: string, fn: () => Promise<unknown>) => fn()),
    mockIsSuppressed: vi.fn(),
    mockIsDuplicate: vi.fn(),
    mockRecordSend: vi.fn(),
    mockSend: vi.fn(),
  }));

vi.mock("../infra/postgres.js", () => ({
  pg: { query: mockPgQuery },
  pgElevated: { query: mockElevatedQuery },
  withTenant: mockWithTenant,
}));

vi.mock("../lib/alerting/alertPrimitives.js", () => ({
  getResend: () => ({ emails: { send: mockSend } }),
  getFromAddress: () => "alerts@securelogicai.test",
  getAppBaseUrl: () => "https://app.test",
  htmlEscape: (s: string) => s,
  isSuppressed: mockIsSuppressed,
  isDuplicate: mockIsDuplicate,
  recordSend: mockRecordSend,
}));

import { runDailySlaBreachSweep } from "../lib/slaBreachScheduler.js";

const ORG = { id: "11111111-1111-4111-8111-111111111111", name: "Acme" };
const OWNER_A = "22222222-2222-4222-8222-222222222222";
const OWNER_B = "33333333-3333-4333-8333-333333333333";

function breached(kind: "finding" | "action", id: string, owner: string, extra: Record<string, unknown> = {}) {
  return {
    kind,
    id,
    title: `${kind} ${id}`,
    severity: kind === "finding" ? "High" : null,
    due_date: "2026-07-29",
    owner_user_id: owner,
    parent_finding_id: null,
    ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env["SECURELOGIC_SLA_ALERTS_ENABLED"] = "true";
  mockElevatedQuery.mockResolvedValue({ rowCount: 1, rows: [ORG] });
  mockIsSuppressed.mockResolvedValue(false);
  mockIsDuplicate.mockResolvedValue(false);
  mockSend.mockResolvedValue({});
  mockRecordSend.mockResolvedValue(undefined);
});

afterEach(() => {
  delete process.env["SECURELOGIC_SLA_ALERTS_ENABLED"];
});

describe("runDailySlaBreachSweep", () => {
  it("flag off → a zero-DB no-op", async () => {
    delete process.env["SECURELOGIC_SLA_ALERTS_ENABLED"];

    const summary = await runDailySlaBreachSweep();

    expect(summary).toEqual({ orgsProcessed: 0, emailsSent: 0, itemsNotified: 0, itemsDeduped: 0 });
    expect(mockElevatedQuery).not.toHaveBeenCalled();
    expect(mockPgQuery).not.toHaveBeenCalled();
  });

  it("groups per owner: two owners, one email each, every item deep-linked and ledger-stamped", async () => {
    mockPgQuery
      .mockResolvedValueOnce({
        rowCount: 3,
        rows: [
          breached("finding", "f-1", OWNER_A),
          breached("action", "a-1", OWNER_A, { parent_finding_id: "f-9" }),
          breached("finding", "f-2", OWNER_B),
        ],
      })
      // recipient reads, one per owner (in Map insertion order)
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ email: "a@acme.test" }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ email: "b@acme.test" }] });

    const summary = await runDailySlaBreachSweep();

    expect(summary.emailsSent).toBe(2);
    expect(summary.itemsNotified).toBe(3);
    expect(mockSend).toHaveBeenCalledTimes(2);
    const first = mockSend.mock.calls[0]![0];
    expect(first.to).toBe("a@acme.test");
    expect(first.subject).toContain("2 items");
    expect(first.html).toContain("https://app.test/findings/f-1");
    // Action deep-links to its PARENT finding, where the work is done.
    expect(first.html).toContain("https://app.test/findings/f-9");
    expect(mockRecordSend).toHaveBeenCalledWith(OWNER_A, "sla_breach_daily", "finding:f-1:2026-07-29");
    expect(mockRecordSend).toHaveBeenCalledWith(OWNER_A, "sla_breach_daily", "action:a-1:2026-07-29");
    // The eligibility read defaults the preference ON when no row exists.
    const recipientSql = String(mockPgQuery.mock.calls[1]![0]);
    expect(recipientSql).toMatch(/COALESCE\(uap\.sla_breach_daily, TRUE\)/);
  });

  it("an ineligible owner (preference off / inactive) is skipped without failing the sweep", async () => {
    mockPgQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [breached("finding", "f-1", OWNER_A)] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] }); // recipient ineligible

    const summary = await runDailySlaBreachSweep();

    expect(summary.emailsSent).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("already-notified items are ledger-deduped; an all-deduped owner gets NO email", async () => {
    mockPgQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [breached("finding", "f-1", OWNER_A)] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ email: "a@acme.test" }] });
    mockIsDuplicate.mockResolvedValue(true);

    const summary = await runDailySlaBreachSweep();

    expect(summary.itemsDeduped).toBe(1);
    expect(summary.emailsSent).toBe(0);
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("a send failure leaves the ledger unstamped so tomorrow's sweep can retry", async () => {
    mockPgQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [breached("finding", "f-1", OWNER_A)] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ email: "a@acme.test" }] });
    mockSend.mockRejectedValue(new Error("smtp down"));

    const summary = await runDailySlaBreachSweep();

    expect(summary.emailsSent).toBe(0);
    expect(mockRecordSend).not.toHaveBeenCalled();
  });

  it("the breach query targets work that became overdue within the 7-day catch-up window, active and owned only", async () => {
    mockPgQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    await runDailySlaBreachSweep();

    const sql = String(mockPgQuery.mock.calls[0]![0]);
    expect(sql).toMatch(/due_date < CURRENT_DATE/);
    // 7 days, not 1: a failed send, missed cron tick, or overflowed email must
    // be re-selectable by a later sweep — the per-(user, item, due-date) ledger
    // keeps the catch-up spam-free.
    expect(sql).toMatch(/due_date >= CURRENT_DATE - 7/);
    expect(sql).toMatch(/owner_user_id IS NOT NULL/);
    expect((mockPgQuery.mock.calls[0]![1] as unknown[])[0]).toBe(ORG.id);
  });
});
