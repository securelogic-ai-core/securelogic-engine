import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// EMAIL-OBS-1: this suite drives a MOCKED provider. The shared transport
// refuses to send from a test runner unless this opt-out is set explicitly
// (see emailTransport.isTestRunnerSendBlocked) — per file, greppable.
process.env.SECURELOGIC_EMAIL_ALLOW_TEST_SEND = "true";

const { mockPgQuery, mockWithTenant, mockIsSuppressed, mockIsDuplicate, mockRecordSend, mockSend } =
  vi.hoisted(() => ({
    mockPgQuery: vi.fn(),
    mockWithTenant: vi.fn(async (_orgId: string, fn: () => Promise<unknown>) => fn()),
    mockIsSuppressed: vi.fn(),
    mockIsDuplicate: vi.fn(),
    mockRecordSend: vi.fn(),
    mockSend: vi.fn(),
  }));

vi.mock("../infra/postgres.js", () => ({
  pg: { query: mockPgQuery },
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

import {
  triggerAssignmentAlert,
  assignmentAlertsEnabled,
} from "../lib/assignmentAlertTrigger.js";

const ORG = "11111111-1111-4111-8111-111111111111";
const ASSIGNEE = "22222222-2222-4222-8222-222222222222";
const ACTOR = "33333333-3333-4333-8333-333333333333";

const settle = () => new Promise((resolve) => setImmediate(resolve));

function input(overrides: Partial<Parameters<typeof triggerAssignmentAlert>[0]> = {}) {
  return {
    organizationId: ORG,
    assigneeUserId: ASSIGNEE,
    actorUserId: ACTOR,
    item: {
      kind: "finding" as const,
      id: "f-1",
      title: "Unencrypted backups",
      severity: "High",
      dueDate: "2026-08-15",
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // The behaviour suite below asserts what the notification does when it is
  // switched ON. The flag defaults OFF, so it must be stubbed here — without
  // this every expectation in that suite would pass vacuously.
  vi.stubEnv("SECURELOGIC_ASSIGNMENT_ALERTS_ENABLED", "true");
  mockPgQuery.mockResolvedValue({
    rowCount: 1,
    rows: [{ email: "owner@acme.test", organization_name: "Acme" }],
  });
  mockIsSuppressed.mockResolvedValue(false);
  mockIsDuplicate.mockResolvedValue(false);
  mockSend.mockResolvedValue({});
  mockRecordSend.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("assignmentAlertsEnabled — fails closed", () => {
  it("is ON only for the exact string \"true\"", () => {
    expect(assignmentAlertsEnabled({ SECURELOGIC_ASSIGNMENT_ALERTS_ENABLED: "true" })).toBe(true);
  });

  it("is OFF when the variable is absent", () => {
    expect(assignmentAlertsEnabled({})).toBe(false);
  });

  it.each([
    ["empty", ""],
    ["whitespace", " "],
    ["uppercase", "TRUE"],
    ["mixed case", "True"],
    ["padded", " true "],
    ["numeric", "1"],
    ["yes", "yes"],
    ["on", "on"],
    ["explicit false", "false"],
    ["garbage", "enabled-please"],
  ])("is OFF for a malformed value (%s)", (_label, value) => {
    expect(assignmentAlertsEnabled({ SECURELOGIC_ASSIGNMENT_ALERTS_ENABLED: value })).toBe(false);
  });
});

describe("triggerAssignmentAlert — flag OFF", () => {
  it("sends no email and does no work at all when the flag is absent", async () => {
    vi.stubEnv("SECURELOGIC_ASSIGNMENT_ALERTS_ENABLED", "");

    triggerAssignmentAlert(input());
    await settle();
    await settle();

    // The customer-facing send is the thing that must not happen…
    expect(mockSend).not.toHaveBeenCalled();
    // …and nothing upstream of it should run either: no tenant scope, no
    // eligibility read, no ledger write.
    expect(mockWithTenant).not.toHaveBeenCalled();
    expect(mockPgQuery).not.toHaveBeenCalled();
    expect(mockRecordSend).not.toHaveBeenCalled();
  });

  it("sends no email when the flag is explicitly false", async () => {
    vi.stubEnv("SECURELOGIC_ASSIGNMENT_ALERTS_ENABLED", "false");

    triggerAssignmentAlert(input());
    await settle();
    await settle();

    expect(mockSend).not.toHaveBeenCalled();
    expect(mockWithTenant).not.toHaveBeenCalled();
  });

  it("sends no email for a malformed truthy-looking value", async () => {
    vi.stubEnv("SECURELOGIC_ASSIGNMENT_ALERTS_ENABLED", "TRUE");

    triggerAssignmentAlert(input());
    await settle();
    await settle();

    expect(mockSend).not.toHaveBeenCalled();
    expect(mockWithTenant).not.toHaveBeenCalled();
  });

  it("holds back an action assignment too, not just findings", async () => {
    vi.stubEnv("SECURELOGIC_ASSIGNMENT_ALERTS_ENABLED", "");

    triggerAssignmentAlert(
      input({
        item: { kind: "action", id: "a-1", title: "Rotate keys", parentFindingId: "f-9", dueDate: null },
      })
    );
    await settle();
    await settle();

    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe("triggerAssignmentAlert", () => {
  it("emails the new owner with a deep link to the finding and records the ledger send", async () => {
    triggerAssignmentAlert(input());
    await settle();
    await settle();

    expect(mockWithTenant).toHaveBeenCalledWith(ORG, expect.any(Function));
    // Eligibility query is scoped to the assignee AND the org, defaulting the
    // preference ON when no row exists.
    const [sql, params] = mockPgQuery.mock.calls[0]!;
    expect(String(sql)).toMatch(/COALESCE\(uap\.assignment_immediate, TRUE\)/);
    expect(params).toEqual([ASSIGNEE, ORG]);

    expect(mockSend).toHaveBeenCalledTimes(1);
    const sent = mockSend.mock.calls[0]![0];
    expect(sent.to).toBe("owner@acme.test");
    expect(sent.subject).toContain("Unencrypted backups");
    expect(sent.html).toContain("https://app.test/findings/f-1");
    expect(mockRecordSend).toHaveBeenCalledWith(ASSIGNEE, "assignment_immediate", "finding:f-1");
  });

  it("self-assignment never notifies — not even a query", async () => {
    triggerAssignmentAlert(input({ actorUserId: ASSIGNEE }));
    await settle();

    expect(mockWithTenant).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("preference-off / inactive / unverified assignee (empty eligibility read) → silent no-op", async () => {
    mockPgQuery.mockResolvedValue({ rowCount: 0, rows: [] });

    triggerAssignmentAlert(input());
    await settle();
    await settle();

    expect(mockSend).not.toHaveBeenCalled();
    expect(mockRecordSend).not.toHaveBeenCalled();
  });

  it("ledger duplicate (same user, same record) → no second email", async () => {
    mockIsDuplicate.mockResolvedValue(true);

    triggerAssignmentAlert(input());
    await settle();
    await settle();

    expect(mockSend).not.toHaveBeenCalled();
  });

  it("an action born from a finding deep-links to the parent finding where the work lives", async () => {
    triggerAssignmentAlert(
      input({
        item: {
          kind: "action",
          id: "a-1",
          title: "Rotate keys",
          parentFindingId: "f-9",
          dueDate: null,
        },
      })
    );
    await settle();
    await settle();

    const sent = mockSend.mock.calls[0]![0];
    expect(sent.html).toContain("https://app.test/findings/f-9");
    expect(mockRecordSend).toHaveBeenCalledWith(ASSIGNEE, "assignment_immediate", "action:a-1");
  });

  it("send failure is swallowed and the ledger is NOT stamped — the next assignment can retry", async () => {
    mockSend.mockRejectedValue(new Error("smtp down"));

    triggerAssignmentAlert(input());
    await settle();
    await settle();

    expect(mockRecordSend).not.toHaveBeenCalled();
  });
});
