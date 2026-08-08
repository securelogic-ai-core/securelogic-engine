import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn(), connect: vi.fn() },
}));
vi.mock("../infra/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../lib/auditLog.js", () => ({
  writeAuditEvent: vi.fn(),
}));

import { pg } from "../infra/postgres.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import {
  promoteApprovedAcceptance,
  riskPromotionEnabled,
} from "../lib/riskPromotionService.js";

const query = pg.query as unknown as ReturnType<typeof vi.fn>;

const INPUT = {
  organizationId: "org-1",
  acceptanceId: "acc-1",
  findingId: "11111111-1111-1111-1111-111111111111",
  actorUserId: "user-approver",
  actorApiKeyId: null,
};

const SOURCE_ROW = {
  title: "S3 bucket public",
  severity: "High",
  domain: "Cloud",
  likelihood: "high",
  rationale: "Compensating control in place.",
  owner_name: "Ada Lovelace",
};

function rows(r: unknown[]) {
  return { rows: r };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SECURELOGIC_FINDING_RISK_PROMOTION_ENABLED = "true";
});

afterEach(() => {
  delete process.env.SECURELOGIC_FINDING_RISK_PROMOTION_ENABLED;
});

describe("riskPromotionEnabled — dark by default", () => {
  it("only the literal string 'true' enables", () => {
    delete process.env.SECURELOGIC_FINDING_RISK_PROMOTION_ENABLED;
    expect(riskPromotionEnabled()).toBe(false);
    process.env.SECURELOGIC_FINDING_RISK_PROMOTION_ENABLED = "1";
    expect(riskPromotionEnabled()).toBe(false);
    process.env.SECURELOGIC_FINDING_RISK_PROMOTION_ENABLED = "TRUE";
    expect(riskPromotionEnabled()).toBe(false);
    process.env.SECURELOGIC_FINDING_RISK_PROMOTION_ENABLED = "true";
    expect(riskPromotionEnabled()).toBe(true);
  });
});

describe("promoteApprovedAcceptance — flag off", () => {
  it("is a pure no-op: no queries, no audit, promoted=false", async () => {
    delete process.env.SECURELOGIC_FINDING_RISK_PROMOTION_ENABLED;
    const result = await promoteApprovedAcceptance(INPUT);
    expect(result).toEqual({ promoted: false, riskId: null, created: false });
    expect(query).not.toHaveBeenCalled();
    expect(writeAuditEvent).not.toHaveBeenCalled();
  });
});

describe("promoteApprovedAcceptance — create path", () => {
  it("creates the register risk, stamps promoted_risk_id, audits with created=true", async () => {
    query
      .mockResolvedValueOnce(rows([SOURCE_ROW])) // source read
      .mockResolvedValueOnce(rows([{ id: "risk-new" }])) // INSERT … RETURNING
      .mockResolvedValueOnce(rows([])); // UPDATE acceptance

    const result = await promoteApprovedAcceptance(INPUT);

    expect(result).toEqual({ promoted: true, riskId: "risk-new", created: true });

    // INSERT params: org, title, description, domain, likelihood, rating, owner, finding
    const insertParams = query.mock.calls[1][1];
    expect(insertParams[0]).toBe("org-1");
    expect(insertParams[1]).toBe("S3 bucket public");
    expect(insertParams[2]).toContain("Compensating control in place.");
    expect(insertParams[2]).toContain("Promoted from an approved finding risk acceptance");
    expect(insertParams[3]).toBe("Cloud");
    expect(insertParams[4]).toBe("likely"); // finding 'high' → risks 'likely'
    expect(insertParams[5]).toBe("High"); // severity passes through as impact + rating
    expect(insertParams[6]).toBe("Ada Lovelace");
    expect(insertParams[7]).toBe(INPUT.findingId);
    // status/source_type are inlined in the SQL, not parameters
    expect(query.mock.calls[1][0]).toContain("'accepted'");
    expect(query.mock.calls[1][0]).toContain("'finding_promotion'");

    // promoted_risk_id stamped on the acceptance, org-scoped
    const updateParams = query.mock.calls[2][1];
    expect(updateParams).toEqual(["acc-1", "org-1", "risk-new"]);

    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        eventType: "risk.promoted",
        resourceType: "risk",
        resourceId: "risk-new",
        payload: expect.objectContaining({ created: true }),
      })
    );
  });

  it("maps unknown severity → Moderate, null likelihood → possible, null domain → General", async () => {
    query
      .mockResolvedValueOnce(
        rows([{ ...SOURCE_ROW, severity: "weird", likelihood: null, domain: null }])
      )
      .mockResolvedValueOnce(rows([{ id: "risk-new" }]))
      .mockResolvedValueOnce(rows([]));

    await promoteApprovedAcceptance(INPUT);

    const insertParams = query.mock.calls[1][1];
    expect(insertParams[3]).toBe("General");
    expect(insertParams[4]).toBe("possible");
    expect(insertParams[5]).toBe("Moderate");
  });

  it("description survives a null rationale (provenance sentence only)", async () => {
    query
      .mockResolvedValueOnce(rows([{ ...SOURCE_ROW, rationale: null }]))
      .mockResolvedValueOnce(rows([{ id: "risk-new" }]))
      .mockResolvedValueOnce(rows([]));

    await promoteApprovedAcceptance(INPUT);

    const description = query.mock.calls[1][1][2];
    expect(description).toMatch(/^Promoted from an approved finding risk acceptance/);
  });
});

describe("promoteApprovedAcceptance — link path (re-approval, one risk per finding)", () => {
  it("links the new acceptance to the existing risk, never a second row", async () => {
    query
      .mockResolvedValueOnce(rows([SOURCE_ROW])) // source read
      .mockResolvedValueOnce(rows([])) // INSERT skipped by NOT EXISTS
      .mockResolvedValueOnce(rows([{ id: "risk-existing" }])) // follow-up SELECT
      .mockResolvedValueOnce(rows([])); // UPDATE acceptance

    const result = await promoteApprovedAcceptance(INPUT);

    expect(result).toEqual({ promoted: true, riskId: "risk-existing", created: false });
    expect(query.mock.calls[3][1]).toEqual(["acc-1", "org-1", "risk-existing"]);
    expect(writeAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceId: "risk-existing",
        payload: expect.objectContaining({ created: false }),
      })
    );
  });
});

describe("promoteApprovedAcceptance — degraded paths never throw", () => {
  it("missing finding/acceptance pair → skip, no writes, no audit", async () => {
    query.mockResolvedValueOnce(rows([]));

    const result = await promoteApprovedAcceptance(INPUT);

    expect(result).toEqual({ promoted: false, riskId: null, created: false });
    expect(query).toHaveBeenCalledTimes(1);
    expect(writeAuditEvent).not.toHaveBeenCalled();
  });

  it("neither created nor found → promoted=false, acceptance left unstamped", async () => {
    query
      .mockResolvedValueOnce(rows([SOURCE_ROW]))
      .mockResolvedValueOnce(rows([])) // INSERT skipped
      .mockResolvedValueOnce(rows([])); // SELECT finds nothing

    const result = await promoteApprovedAcceptance(INPUT);

    expect(result).toEqual({ promoted: false, riskId: null, created: false });
    expect(query).toHaveBeenCalledTimes(3); // no UPDATE issued
    expect(writeAuditEvent).not.toHaveBeenCalled();
  });
});
