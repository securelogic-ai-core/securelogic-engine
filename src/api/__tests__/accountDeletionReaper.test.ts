/**
 * accountDeletionReaper.test.ts — behavioral coverage of the Art.17 erasure
 * handler. The destructive ordering, the idempotency gate, legal_consents
 * scrub-not-delete (D-2), and the R2-purge handling are all safety-critical:
 * a wrong order leaks the email the TEXT scrub needs; a missing gate double-
 * reaps; deleting legal_consents violates the retention obligation.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockQuery, mockWithTenant, mockDeleteObject } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockWithTenant: vi.fn(),
  mockDeleteObject: vi.fn(),
}));

vi.mock("../infra/postgres.js", () => ({
  pg: { query: mockQuery },
  pgElevated: { query: mockQuery },
  // withTenant just runs the callback (ambient pg is mocked).
  withTenant: (_org: string, fn: () => unknown) => {
    mockWithTenant(_org);
    return fn();
  },
}));
vi.mock("../lib/blobStorage.js", () => ({ deleteObject: mockDeleteObject }));
vi.mock("../infra/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { processReapJob } from "../workers/accountDeletionReaper.js";
import { BlobStorageNotConfiguredError } from "../lib/blobStorageConfig.js";

const ORG = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EMAIL = "victim@example.com";

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: "job-1",
    organization_id: ORG,
    requested_by_user_id: USER,
    job_type: "account_deletion_reap",
    status: "processing",
    attempts: 1,
    max_attempts: 5,
    payload: { userId: USER },
    ...overrides,
  } as any;
}

/** Default happy-path query router keyed on the SQL text. */
function installDefaultQueries(opts: { status?: string; exportFiles?: any[]; tombstoneRows?: number } = {}) {
  const status = opts.status ?? "pending_deletion";
  const exportFiles = opts.exportFiles ?? [];
  const tombstoneRows = opts.tombstoneRows ?? 1;
  mockQuery.mockImplementation((sql: string) => {
    if (/SELECT email, status FROM users/.test(sql)) {
      return Promise.resolve({ rows: status ? [{ email: EMAIL, status }] : [] });
    }
    if (/UPDATE users SET/.test(sql)) {
      return Promise.resolve({ rowCount: tombstoneRows });
    }
    if (/SELECT id, r2_key FROM data_export_files/.test(sql)) {
      return Promise.resolve({ rows: exportFiles });
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });
}

function sqls(): string[] {
  return mockQuery.mock.calls.map((c) => String(c[0]).replace(/\s+/g, " ").trim());
}
function idxMatching(re: RegExp): number {
  return sqls().findIndex((s) => re.test(s));
}

beforeEach(() => {
  mockQuery.mockReset();
  mockWithTenant.mockReset();
  mockDeleteObject.mockReset();
  mockDeleteObject.mockResolvedValue(undefined);
});

describe("erasure ordering + completeness", () => {
  it("runs gate → reviewer TEXT scrub → Category-B deletes → legal_consents scrub → users tombstone LAST", async () => {
    installDefaultQueries();
    await processReapJob(job(), { now: () => new Date("2026-06-24T00:00:00Z") });

    const gate = idxMatching(/SELECT email, status FROM users/);
    const reviewer = idxMatching(/UPDATE risk_treatments SET reviewer_id = NULL/);
    const bDelete = idxMatching(/DELETE FROM password_history/);
    const consentScrub = idxMatching(/UPDATE legal_consents SET ip_address = NULL/);
    const tombstone = idxMatching(/UPDATE users SET/);

    expect(gate).toBeGreaterThanOrEqual(0);
    expect(gate).toBeLessThan(reviewer);
    expect(reviewer).toBeLessThan(bDelete);
    expect(bDelete).toBeLessThan(consentScrub);
    expect(consentScrub).toBeLessThan(tombstone); // tombstone is LAST (scrubs the email)
  });

  it("scrubs the deprecated reviewer_id in all 5 TEXT tables, matched by the captured email", async () => {
    installDefaultQueries();
    await processReapJob(job());
    for (const t of ["risk_treatments", "obligation_assessments", "vendor_reviews", "ai_governance_assessments", "dependency_assessments"]) {
      const call = mockQuery.mock.calls.find((c) => new RegExp(`UPDATE ${t} SET reviewer_id = NULL`).test(String(c[0])));
      expect(call, t).toBeTruthy();
      expect(call![1]).toEqual([ORG, EMAIL]);
    }
  });

  it("SCRUBS legal_consents (retain) and never DELETEs it (D-2)", async () => {
    installDefaultQueries();
    await processReapJob(job());
    expect(idxMatching(/UPDATE legal_consents SET ip_address = NULL, user_agent = NULL/)).toBeGreaterThanOrEqual(0);
    expect(sqls().some((s) => /DELETE FROM legal_consents/.test(s))).toBe(false);
    expect(sqls().some((s) => /DELETE FROM org_invites/.test(s))).toBe(false); // D-3 leave
  });

  it("marks the job succeeded (outcome 'erased')", async () => {
    installDefaultQueries();
    await processReapJob(job());
    const success = mockQuery.mock.calls.find((c) => /UPDATE jobs\s+SET status = 'succeeded'/.test(String(c[0])));
    expect(success).toBeTruthy();
    expect(String(success![1]?.[1])).toContain("erased");
  });
});

describe("idempotency gate", () => {
  it("no-ops (no destructive writes) when status is not 'pending_deletion'", async () => {
    installDefaultQueries({ status: "deleted" });
    await processReapJob(job());
    expect(sqls().some((s) => /UPDATE users SET email/.test(s) || /^UPDATE users SET /.test(s))).toBe(false);
    expect(sqls().some((s) => /DELETE FROM password_history/.test(s))).toBe(false);
    // still records success (outcome 'skipped')
    const success = mockQuery.mock.calls.find((c) => /UPDATE jobs\s+SET status = 'succeeded'/.test(String(c[0])));
    expect(String(success![1]?.[1])).toContain("skipped");
  });

  it("aborts and records failure when the tombstone affects 0 rows (racing cancel)", async () => {
    installDefaultQueries({ tombstoneRows: 0 });
    await processReapJob(job());
    // not marked succeeded; failure path updates the job to a retry/terminal state
    expect(sqls().some((s) => /UPDATE jobs SET status = 'succeeded'/.test(s))).toBe(false);
    expect(sqls().some((s) => /UPDATE jobs\s+SET status = \$2/.test(s))).toBe(true);
  });
});

describe("R2 export-bundle purge (Phase 2)", () => {
  it("deletes each un-purged bundle then scrubs IP + sets purged_at (D-7/D-8)", async () => {
    installDefaultQueries({ exportFiles: [{ id: "f1", r2_key: "org/x/data-exports/e1.zip" }] });
    await processReapJob(job());
    expect(mockDeleteObject).toHaveBeenCalledWith({ organizationId: ORG, key: "org/x/data-exports/e1.zip" });
    expect(sqls().some((s) => /UPDATE data_export_files SET downloaded_from_ip = NULL, purged_at = \$2/.test(s))).toBe(true);
  });

  it("when R2 is not configured: skips purge, leaves purged_at, job still succeeds", async () => {
    installDefaultQueries({ exportFiles: [{ id: "f1", r2_key: "org/x/data-exports/e1.zip" }] });
    mockDeleteObject.mockRejectedValueOnce(new BlobStorageNotConfiguredError());
    await processReapJob(job());
    expect(sqls().some((s) => /UPDATE data_export_files SET downloaded_from_ip = NULL/.test(s))).toBe(false);
    expect(sqls().some((s) => /UPDATE jobs SET status = 'succeeded'/.test(s))).toBe(true);
  });
});
