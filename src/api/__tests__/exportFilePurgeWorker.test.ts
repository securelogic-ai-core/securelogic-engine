/**
 * exportFilePurgeWorker — unit guards for the O-11 export-bundle TTL sweep.
 *
 * The schema declared this job from day one (purged_at column comment,
 * expires index, 'export_file_purge' job type) but no worker existed;
 * expired bundles sat in R2 indefinitely. These tests pin the sweep's
 * contract: expired-and-unpurged candidates only, R2-delete-then-mark
 * ordering, D-8 IP scrub, per-file fault isolation, the unconfigured-R2
 * early exit, and the ops brake.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const elevatedQueryMock = vi.fn();
const deleteObjectMock = vi.fn();

vi.mock("../infra/postgres.js", () => ({
  pg: { query: vi.fn() },
  pgElevated: { query: (...args: unknown[]) => elevatedQueryMock(...args) },
  withTenant: vi.fn(),
}));
vi.mock("../infra/logger.js", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("../lib/blobStorage.js", () => ({
  deleteObject: (...args: unknown[]) => deleteObjectMock(...args),
}));

import { BlobStorageNotConfiguredError } from "../lib/blobStorageConfig.js";
import {
  runExportFilePurgeSweep,
  exportFilePurgeDisabled,
} from "../workers/exportFilePurgeWorker.js";

const FILE_A = { id: "file-a", organization_id: "org-1", r2_key: "exports/a.zip" };
const FILE_B = { id: "file-b", organization_id: "org-2", r2_key: "exports/b.zip" };

beforeEach(() => {
  elevatedQueryMock.mockReset();
  deleteObjectMock.mockReset();
  delete process.env["SECURELOGIC_EXPORT_PURGE_DISABLED"];
});

afterEach(() => {
  delete process.env["SECURELOGIC_EXPORT_PURGE_DISABLED"];
});

describe("runExportFilePurgeSweep", () => {
  it("selects only expired, unpurged rows and purges them R2-first", async () => {
    elevatedQueryMock
      .mockResolvedValueOnce({ rows: [FILE_A, FILE_B], rowCount: 2 }) // candidates
      .mockResolvedValue({ rows: [], rowCount: 1 }); // the two UPDATEs
    deleteObjectMock.mockResolvedValue(undefined);

    const result = await runExportFilePurgeSweep();

    const [selectSql] = elevatedQueryMock.mock.calls[0] as [string];
    expect(selectSql).toContain("purged_at IS NULL");
    expect(selectSql).toContain("download_token_expires_at <= NOW()");

    expect(deleteObjectMock).toHaveBeenCalledWith({ organizationId: "org-1", key: "exports/a.zip" });
    expect(deleteObjectMock).toHaveBeenCalledWith({ organizationId: "org-2", key: "exports/b.zip" });

    // Mark-purged runs AFTER the R2 delete and scrubs the IP (D-8),
    // guarded by purged_at IS NULL so concurrent sweeps can't double-mark.
    const updateCalls = elevatedQueryMock.mock.calls.slice(1);
    expect(updateCalls).toHaveLength(2);
    for (const [sql] of updateCalls as Array<[string]>) {
      expect(sql).toContain("downloaded_from_ip = NULL");
      expect(sql).toContain("purged_at = NOW()");
      expect(sql).toContain("purged_at IS NULL");
    }

    expect(result).toEqual({ candidates: 2, purged: 2, storage_unconfigured: false });
  });

  it("one file's R2 failure does not stop the batch and leaves its row unpurged", async () => {
    elevatedQueryMock
      .mockResolvedValueOnce({ rows: [FILE_A, FILE_B], rowCount: 2 })
      .mockResolvedValue({ rows: [], rowCount: 1 });
    deleteObjectMock
      .mockRejectedValueOnce(new Error("r2 hiccup"))
      .mockResolvedValueOnce(undefined);

    const result = await runExportFilePurgeSweep();

    // Only FILE_B got marked purged; FILE_A retries next sweep.
    expect(elevatedQueryMock.mock.calls.length).toBe(2); // select + one update
    expect(result.purged).toBe(1);
  });

  it("stops the whole sweep when blob storage is not configured", async () => {
    elevatedQueryMock.mockResolvedValueOnce({ rows: [FILE_A, FILE_B], rowCount: 2 });
    deleteObjectMock.mockRejectedValue(new BlobStorageNotConfiguredError("no R2"));

    const result = await runExportFilePurgeSweep();

    expect(deleteObjectMock).toHaveBeenCalledTimes(1); // no point trying the rest
    expect(elevatedQueryMock.mock.calls.length).toBe(1); // no row marked purged
    expect(result).toEqual({ candidates: 2, purged: 0, storage_unconfigured: true });
  });

  it("ops brake short-circuits before any query", async () => {
    process.env["SECURELOGIC_EXPORT_PURGE_DISABLED"] = "true";

    const result = await runExportFilePurgeSweep();

    expect(elevatedQueryMock).not.toHaveBeenCalled();
    expect(result).toEqual({ candidates: 0, purged: 0, storage_unconfigured: false });
  });

  it("exportFilePurgeDisabled reads only the exact 'true' value", () => {
    expect(exportFilePurgeDisabled({ SECURELOGIC_EXPORT_PURGE_DISABLED: "true" } as NodeJS.ProcessEnv)).toBe(true);
    expect(exportFilePurgeDisabled({ SECURELOGIC_EXPORT_PURGE_DISABLED: "1" } as NodeJS.ProcessEnv)).toBe(false);
    expect(exportFilePurgeDisabled({} as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe("server wiring", () => {
  it("server.ts registers the purge worker at boot", () => {
    const source = readFileSync(resolve(__dirname, "../server.ts"), "utf8");
    expect(source).toContain("startExportFilePurgeWorker()");
  });
});
