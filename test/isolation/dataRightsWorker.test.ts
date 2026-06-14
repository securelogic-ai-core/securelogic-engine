/**
 * dataRightsWorker.test.ts — cross-org isolation + integration test for the
 * GDPR/CCPA data-rights worker (PR #3).
 *
 * Runs the REAL worker pipeline against a REAL Postgres: the claim poll on the
 * elevated channel, then per-job execution + the terminal jobs UPDATE inside
 * withTenant(job.organization_id). The ONLY injected seam is the bundle sink —
 * a Buffer instead of R2 — so no network is touched and we can inspect the zip.
 *
 * It proves the two load-bearing invariants the worker must satisfy (the
 * A04-G1-adjacent surface):
 *
 *   (a) A worker processing org A's export job never reads org B's rows — org
 *       B's user/finding appear nowhere in org A's bundle, for BOTH a
 *       data_export_org and a data_export_self job.
 *
 *   (b) subject.userEmail is resolved from users.email IN THE DB (inside
 *       withTenant), NEVER from job.payload — a data_export_self job whose
 *       payload carries a POISONED email produces a bundle keyed by the real
 *       DB email, and the poison never appears anywhere in the bundle.
 *
 * It also asserts the terminal write (Decision D-1): status='succeeded' with a
 * jobs.result of { r2_key, file_size_bytes, scope } and no data_export_files row
 * (deferred to PR #5).
 *
 * setup.ts points DATABASE_URL at TEST_DATABASE_URL before this module imports,
 * so infra/postgres (pulled in by dataRightsWorker) boots against the throwaway
 * DB; pgElevated falls back to DATABASE_URL (no MIGRATION_DATABASE_URL), so the
 * claim poll and the withTenant bodies all hit the same throwaway database.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import { Pool } from "pg";
import yauzl from "yauzl";

import { bootstrapTestDb, seedUser, type TestDbSeed } from "./testDb.js";
import { runOneTick } from "../../src/api/workers/dataRightsWorker.js";
import type { ObjectWriteHandle } from "../../src/api/lib/blobStorage.js";
import { BlobStorageNotConfiguredError } from "../../src/api/lib/blobStorageConfig.js";

let seed: TestDbSeed;
let pool: Pool;
let userA: { id: string; email: string };
let userB: { id: string; email: string };

const SCHEMA_VERSION = "20260621_gdpr_foundations";
const POISON_EMAIL = "attacker-poison@evil.example.com";

/** A Buffer-backed sink that mimics blobStorage's ObjectWriteHandle. */
function makeBufferSink(bundles: Map<string, Buffer>) {
  return (orgId: string, exportId: string): ObjectWriteHandle => {
    const chunks: Buffer[] = [];
    let resolveDone!: (v: { key: string; byteSize: number }) => void;
    let rejectDone!: (e: unknown) => void;
    const done = new Promise<{ key: string; byteSize: number }>((res, rej) => {
      resolveDone = res;
      rejectDone = rej;
    });
    done.catch(() => undefined);

    const stream = new Writable({
      write(chunk: Buffer, _enc, cb) {
        chunks.push(Buffer.from(chunk));
        cb();
      },
    });
    stream.on("finish", () => {
      const buf = Buffer.concat(chunks);
      bundles.set(exportId, buf);
      resolveDone({ key: `org/${orgId}/data-exports/${exportId}.zip`, byteSize: buf.length });
    });
    stream.on("error", (e) => rejectDone(e));

    return { stream, done, abort: async () => undefined };
  };
}

function readZip(buf: Buffer): Promise<Map<string, string>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buf, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error("no zip"));
      const out = new Map<string, string>();
      zip.on("error", reject);
      zip.on("entry", (entry: { fileName: string }) => {
        zip.openReadStream(entry, (e, rs) => {
          if (e || !rs) return reject(e ?? new Error("no stream"));
          const cs: Buffer[] = [];
          rs.on("data", (c: Buffer) => cs.push(c));
          rs.on("end", () => {
            out.set(entry.fileName, Buffer.concat(cs).toString("utf8"));
            zip.readEntry();
          });
        });
      });
      zip.on("end", () => resolve(out));
      zip.readEntry();
    });
  });
}

async function seedOwnedFinding(orgId: string, ownerUserId: string, title: string): Promise<void> {
  await pool.query(
    `INSERT INTO findings (organization_id, title, severity, description, source_type, owner_user_id)
     VALUES ($1, $2, 'high', 'worker isolation seed', 'manual', $3)`,
    [orgId, title, ownerUserId],
  );
}

async function enqueueJob(
  orgId: string,
  jobType: "data_export_self" | "data_export_org",
  payload: Record<string, unknown>,
  requestedBy: string | null,
): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO jobs (organization_id, requested_by_user_id, job_type, payload)
     VALUES ($1, $2, $3, $4::jsonb)
     RETURNING id`,
    [orgId, requestedBy, jobType, JSON.stringify(payload)],
  );
  return rows[0].id;
}

beforeAll(async () => {
  seed = await bootstrapTestDb();

  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the data-rights worker test.");
  pool = new Pool({ connectionString: url, ssl: false });

  userA = await seedUser(pool, seed.orgA.id, { email: "subject-a@example.com", withSecrets: true });
  userB = await seedUser(pool, seed.orgB.id, { email: "subject-b@example.com", withSecrets: true });

  await seedOwnedFinding(seed.orgA.id, userA.id, "ORG_A_WORKER_FINDING");
  await seedOwnedFinding(seed.orgB.id, userB.id, "ORG_B_WORKER_FINDING");

  // Give the schema_version read a real bookkeeping table (the harness applies
  // migrations without it), matching dataExport.test.ts.
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       id SERIAL PRIMARY KEY, filename TEXT NOT NULL UNIQUE, applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
  );
  await pool.query(
    `INSERT INTO schema_migrations (filename) VALUES ('20260101_baseline'), ($1)
     ON CONFLICT (filename) DO NOTHING`,
    [SCHEMA_VERSION],
  );
}, 120_000);

afterAll(async () => {
  await pool?.end();
});

describe("data-rights worker — cross-org isolation against real Postgres", () => {
  it("(a) processes an org_full job for org A and never bundles org B's rows", async () => {
    const jobId = await enqueueJob(seed.orgA.id, "data_export_org", {}, userA.id);
    const bundles = new Map<string, Buffer>();

    const processed = await runOneTick({ openSink: makeBufferSink(bundles), workerId: "test-worker" });
    expect(processed).toBeGreaterThanOrEqual(1);

    const bundle = bundles.get(jobId);
    expect(bundle, "org A bundle was written").toBeDefined();
    const entries = await readZip(bundle!);

    const manifest = JSON.parse(entries.get("manifest.json")!);
    expect(manifest.scope).toBe("org_full");
    expect(manifest.target_organization_id).toBe(seed.orgA.id);

    const findings = entries.get("tables/findings.ndjson")!;
    expect(findings).toContain("ORG_A_WORKER_FINDING");
    expect(findings).not.toContain("ORG_B_WORKER_FINDING");

    // Belt-and-suspenders: org B's finding/user/email appear NOWHERE in the bundle.
    const whole = bundle!.toString("latin1");
    expect(whole).not.toContain("ORG_B_WORKER_FINDING");
    expect(whole).not.toContain(userB.email);

    // Terminal write (D-1): succeeded + jobs.result, no data_export_files row.
    const { rows } = await pool.query(
      "SELECT status, result FROM jobs WHERE id = $1",
      [jobId],
    );
    expect(rows[0].status).toBe("succeeded");
    expect(rows[0].result).toMatchObject({ scope: "org_full" });
    expect(rows[0].result.r2_key).toBe(`org/${seed.orgA.id}/data-exports/${jobId}.zip`);
    expect(typeof rows[0].result.file_size_bytes).toBe("number");

    const { rows: files } = await pool.query("SELECT count(*)::int AS n FROM data_export_files");
    expect(files[0].n).toBe(0); // deferred to PR #5
  });

  it("(b) resolves subject email from users.email in the DB, never from job.payload", async () => {
    // Poison the payload email — the worker MUST ignore it and read users.email.
    const jobId = await enqueueJob(
      seed.orgA.id,
      "data_export_self",
      { userId: userA.id, userEmail: POISON_EMAIL },
      userA.id,
    );
    const bundles = new Map<string, Buffer>();

    await runOneTick({ openSink: makeBufferSink(bundles), workerId: "test-worker" });

    const bundle = bundles.get(jobId);
    expect(bundle, "self-export bundle was written").toBeDefined();
    const entries = await readZip(bundle!);

    const manifest = JSON.parse(entries.get("manifest.json")!);
    expect(manifest.scope).toBe("user_self");
    expect(manifest.target_user_id).toBe(userA.id);

    // The real DB email is present; the poisoned payload email is absent everywhere.
    const usersNdjson = entries.get("tables/users.ndjson")!.trim();
    const userRow = JSON.parse(usersNdjson);
    expect(userRow.email).toBe(userA.email);

    const whole = bundle!.toString("latin1");
    expect(whole).not.toContain(POISON_EMAIL);
    // And org B never leaks into a self-export either.
    expect(whole).not.toContain("ORG_B_WORKER_FINDING");
    expect(whole).not.toContain(userB.email);

    const { rows } = await pool.query("SELECT status, result FROM jobs WHERE id = $1", [jobId]);
    expect(rows[0].status).toBe("succeeded");
    expect(rows[0].result).toMatchObject({ scope: "user_self" });
  });

  it("(c) sends a self-export job with an unknown user to 'failed' (non-retryable), not retried", async () => {
    const jobId = await enqueueJob(
      seed.orgA.id,
      "data_export_self",
      { userId: "00000000-0000-4000-8000-000000000000" },
      null,
    );
    const bundles = new Map<string, Buffer>();

    await runOneTick({ openSink: makeBufferSink(bundles), workerId: "test-worker" });

    const { rows } = await pool.query(
      "SELECT status, attempts, error, next_attempt_at FROM jobs WHERE id = $1",
      [jobId],
    );
    expect(rows[0].status).toBe("failed");
    expect(rows[0].next_attempt_at).toBeNull();
    expect(rows[0].error).toContain("not found");
    expect(bundles.get(jobId)).toBeUndefined(); // never produced a bundle
  });

  // An openSink that throws synchronously mimics R2 being unconfigured:
  // createObjectWriteStream → getBlobStorageClient throws BlobStorageNotConfiguredError
  // BEFORE the first await. The fault must be caught at the JOB level (routed
  // through recordFailure/decideFailureState as a retryable config fault), NOT
  // escape to the tick handler and leave the job stale-locked in 'processing'.
  const failingSink = (): ObjectWriteHandle => {
    throw new BlobStorageNotConfiguredError();
  };

  it("(d) an R2-unavailable sink failure is caught per-job → requeued, tick does NOT throw, no stale lock", async () => {
    const jobId = await enqueueJob(seed.orgA.id, "data_export_org", {}, userA.id);

    // The whole point: runOneTick resolves instead of throwing out to the tick
    // handler (which would have logged data_rights_worker_tick_error).
    await expect(
      runOneTick({ openSink: failingSink, workerId: "test-worker" }),
    ).resolves.toBeGreaterThanOrEqual(1);

    const { rows } = await pool.query(
      "SELECT status, attempts, max_attempts, error, next_attempt_at, scheduled_for, locked_by, locked_at FROM jobs WHERE id = $1",
      [jobId],
    );
    const row = rows[0];
    // Retryable: requeued, not failed/dead-lettered, attempts incremented but < max.
    expect(row.status).toBe("queued");
    expect(row.attempts).toBe(1);
    expect(row.attempts).toBeLessThan(row.max_attempts);
    // Backoff was scheduled and the row is NOT stale-locked in 'processing'.
    expect(row.next_attempt_at).not.toBeNull();
    expect(new Date(row.scheduled_for).getTime()).toBeGreaterThan(Date.now());
    expect(row.locked_by).toBeNull();
    expect(row.locked_at).toBeNull();
    // The R2 fault is recorded as the job error.
    expect(row.error).toContain("blob storage is not configured");
  });

  it("(d2) an R2-unavailable sink failure on the final attempt → 'dead_lettered'", async () => {
    // Seed at attempts = max_attempts - 1 (4) so the claim bumps it to max (5)
    // and decideFailureState routes the failure to the terminal dead-letter state.
    const { rows: ins } = await pool.query<{ id: string }>(
      `INSERT INTO jobs (organization_id, requested_by_user_id, job_type, payload, attempts, max_attempts)
       VALUES ($1, $2, 'data_export_org', '{}'::jsonb, 4, 5)
       RETURNING id`,
      [seed.orgA.id, userA.id],
    );
    const jobId = ins[0].id;

    await expect(
      runOneTick({ openSink: failingSink, workerId: "test-worker" }),
    ).resolves.toBeGreaterThanOrEqual(1);

    const { rows } = await pool.query(
      "SELECT status, attempts, error, next_attempt_at, locked_by, locked_at FROM jobs WHERE id = $1",
      [jobId],
    );
    const row = rows[0];
    expect(row.status).toBe("dead_lettered");
    expect(row.attempts).toBe(5);
    expect(row.next_attempt_at).toBeNull();
    expect(row.locked_by).toBeNull();
    expect(row.locked_at).toBeNull();
    expect(row.error).toContain("blob storage is not configured");
  });
});
