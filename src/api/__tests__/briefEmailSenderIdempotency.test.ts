/**
 * briefEmailSenderIdempotency.test.ts — sendBrief must never double-deliver.
 *
 * Drives the real sendBrief() with a mocked postgres and a stubbed Resend HTTP
 * call. Verifies that a subscriber who already has a 'sent' row for the brief is
 * skipped (idempotency guard) while a not-yet-sent subscriber is delivered to.
 * This is the guarantee behind "weekly cron + manual/catch-up run never send
 * the same brief twice".
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn(), connect: vi.fn() },
  withTenant: (_orgId: string, fn: () => Promise<unknown>) => fn(),
  requireTenantContext: vi.fn()
}));

import { sendBrief } from "../lib/briefEmailSender.js";
import { pg } from "../infra/postgres.js";

const pgQuery = vi.mocked(pg.query);

const BRIEF_ID = "11111111-1111-1111-1111-111111111111";
const ORG_ID = "22222222-2222-2222-2222-222222222222";
const SUB_DONE = "33333333-3333-3333-3333-333333333333"; // already received
const SUB_NEW = "44444444-4444-4444-4444-444444444444";  // not yet sent

const briefRow = {
  id: BRIEF_ID,
  organization_id: ORG_ID,
  period_start: "2026-06-30T00:00:00Z",
  period_end: "2026-07-07T00:00:00Z",
  status: "published",
  signal_count: "5",
  high_count: "1",
  medium_count: "0",
  low_count: "0",
  content_json: {}
};

const itemRow = {
  id: "item-1",
  category: "vulnerability",
  title: "Critical RCE in Example Corp appliance",
  summary: "Actively exploited remote code execution.",
  severity: "Critical",
  relevance: "high",
  affected_cve: "CVE-2026-0001",
  sort_order: "0",
  why_it_matters: "Exposed appliances allow full compromise.",
  recommended_actions: "Patch immediately.",
  is_personalized: false
};

function sub(id: string, email: string) {
  return {
    id,
    email,
    name: null,
    min_severity: "Low",
    categories: null,
    notify_vendor_matches_only: false
  };
}

describe("sendBrief — idempotency guard", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    pgQuery.mockReset();
    process.env["RESEND_API_KEY"] = "test-key";
    process.env["BRIEF_FROM_EMAIL"] = "SecureLogic AI <briefs@securelogicai.com>";

    fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => ""
    }));
    vi.stubGlobal("fetch", fetchMock);

    // Bundle read order in sendBrief: brief, items, org, subscribers,
    // suppressions, already-sent; then the post-loop audit INSERT.
    pgQuery
      .mockResolvedValueOnce({ rows: [briefRow] })                       // 1. brief
      .mockResolvedValueOnce({ rows: [itemRow] })                        // 2. items
      .mockResolvedValueOnce({ rows: [{ name: "Acme", plan: "professional" }] }) // 3. org
      .mockResolvedValueOnce({ rows: [sub(SUB_DONE, "done@acme.test"), sub(SUB_NEW, "new@acme.test")] }) // 4. subscribers
      .mockResolvedValueOnce({ rows: [] })                               // 5. suppressions
      .mockResolvedValueOnce({ rows: [{ subscriber_id: SUB_DONE }] })    // 6. already-sent
      .mockResolvedValueOnce({ rows: [] });                              // 7. audit insert
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env["RESEND_API_KEY"];
    delete process.env["BRIEF_FROM_EMAIL"];
  });

  it("skips the already-sent subscriber and delivers only to the new one", async () => {
    const result = await sendBrief(BRIEF_ID, ORG_ID);

    expect(result.already_sent).toBe(1);
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);

    // Exactly one outbound email — to the not-yet-sent subscriber.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(body.to).toEqual(["new@acme.test"]);
    expect(body.from).toContain("securelogicai.com");
  });

  it("records an audit row only for the newly-sent subscriber, not the skipped one", async () => {
    await sendBrief(BRIEF_ID, ORG_ID);

    // The 7th pg.query is the audit INSERT. Its params must reference SUB_NEW
    // (status 'sent') and must NOT re-insert a row for SUB_DONE.
    const auditCall = pgQuery.mock.calls[6]!;
    const auditSql = auditCall[0] as string;
    const auditParams = auditCall[1] as unknown[];
    expect(auditSql).toContain("INSERT INTO intelligence_brief_sends");
    expect(auditParams).toContain(SUB_NEW);
    expect(auditParams).not.toContain(SUB_DONE);
  });
});
