/**
 * dataExportRoutes.test.ts — route-level isolation + behavior for the GDPR/CCPA
 * self-export intake + delivery surface (PR #5).
 *
 * HTTP-level, against the REAL app + REAL Postgres (same harness as
 * crossOrgIsolation.test.ts). It proves the load-bearing properties of the
 * intake + download routes:
 *
 *   • one-pending guard — a second self-export request while one is in flight
 *     returns 409 export_already_pending (Decision C);
 *   • authenticated-download isolation — a user in ANOTHER org, and a DIFFERENT
 *     user in the SAME org, both get 404 for someone else's file (no IDOR);
 *   • tokenized-download isolation — a valid token 302s to a signed URL for
 *     ONLY its own row's object, never another row's;
 *   • token expiry — an expired token is rejected (410).
 *
 * The download routes 302 to a short-lived signed R2 URL (they never proxy
 * bytes). Real R2 is not reachable in CI, but the S3 presigner signs LOCALLY —
 * so with well-formed (fake) R2 env the route produces a real signed URL whose
 * path carries the object key. We assert on that key to prove WHICH object each
 * caller was steered at, without any network I/O.
 *
 * Authentication is by signed JWT (the requireApiKey JWT-bridge): the routes
 * read the user from jwtPayload.sub, so a raw machine API key cannot drive them.
 * Seeded users are given current-version legal consents so requireConsent (which
 * gates JWT sessions) passes.
 */

// Well-formed FAKE R2 env so getBlobStorageClient/the presigner construct a
// real (local) signed URL — no other isolation test reads real R2 (they inject
// sinks / use Buffer sinks), so this is inert for the rest of the suite.
process.env.R2_ACCOUNT_ID ??= "test-account-id";
process.env.R2_ACCESS_KEY_ID ??= "test-access-key-id";
process.env.R2_SECRET_ACCESS_KEY ??= "test-secret-access-key-0123456789";
process.env.R2_BUCKET ??= "test-export-bucket";
process.env.R2_ENDPOINT ??= "https://test-r2.example.com";
process.env.JWT_SECRET ??= "test-jwt-secret-for-data-export-routes";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Express } from "express";
import request from "supertest";
import { Pool } from "pg";

import { bootstrapTestDb, seedUser, type TestDbSeed } from "./testDb.js";
import { signJwt } from "../../src/api/lib/jwt.js";
import { recordAllCurrentConsents } from "../../src/api/lib/legalConsent.js";
import {
  generateDownloadToken,
  hashDownloadToken,
} from "../../src/api/lib/dataExportDownloadToken.js";
import { _resetBlobStorageClientForTests } from "../../src/api/lib/blobStorageConfig.js";

let seed: TestDbSeed;
let pool: Pool;
let app: Express;

// org A has two users; org B has one. JWTs drive the authenticated routes.
let userA1: { id: string; email: string };
let userA2: { id: string; email: string };
let userB1: { id: string; email: string };
let jwtA1: string;
let jwtA2: string;
let jwtB1: string;

interface SeededExport {
  jobId: string;
  fileId: string;
  token: string;
}

/** Insert a completed job + its data_export_files row with a known token. */
async function seedExportFile(
  orgId: string,
  userId: string,
  opts: { token?: string; scope?: string; expiresAt?: Date } = {},
): Promise<SeededExport> {
  const { rows: jobRows } = await pool.query<{ id: string }>(
    `INSERT INTO jobs (organization_id, requested_by_user_id, job_type, status)
     VALUES ($1, $2, 'data_export_self', 'succeeded')
     RETURNING id`,
    [orgId, userId],
  );
  const jobId = jobRows[0].id;
  const token = opts.token ?? generateDownloadToken();
  const expiresAt = opts.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const r2Key = `org/${orgId}/data-exports/${jobId}.zip`;
  const { rows: fileRows } = await pool.query<{ id: string }>(
    `INSERT INTO data_export_files
       (job_id, organization_id, requested_by_user_id, scope, r2_key,
        file_size_bytes, download_token_hash, download_token_expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [jobId, orgId, userId, opts.scope ?? "user_self", r2Key, 4096, hashDownloadToken(token), expiresAt],
  );
  return { jobId, fileId: fileRows[0].id, token };
}

beforeAll(async () => {
  seed = await bootstrapTestDb();

  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the data-export routes test.");
  pool = new Pool({ connectionString: url, ssl: false });

  userA1 = await seedUser(pool, seed.orgA.id, { email: "a1@example.com" });
  userA2 = await seedUser(pool, seed.orgA.id, { email: "a2@example.com" });
  userB1 = await seedUser(pool, seed.orgB.id, { email: "b1@example.com" });

  // requireConsent gates JWT sessions — give each user current consents.
  for (const [u, org] of [
    [userA1, seed.orgA.id],
    [userA2, seed.orgA.id],
    [userB1, seed.orgB.id],
  ] as const) {
    await recordAllCurrentConsents(pool, {
      userId: u.id,
      organizationId: org,
      consentMethod: "admin_recorded",
    });
  }

  jwtA1 = signJwt(userA1.id, seed.orgA.id, "admin");
  jwtA2 = signJwt(userA2.id, seed.orgA.id, "admin");
  jwtB1 = signJwt(userB1.id, seed.orgB.id, "admin");

  const { createApp } = await import("../../src/api/app.js");
  app = createApp({ isDev: false, publicApiDisabled: false });
}, 120_000);

afterAll(async () => {
  await pool?.end();
  _resetBlobStorageClientForTests();
});

describe("data-export intake (POST /api/data-exports)", () => {
  it("creates a queued self-export, then 409s a second pending request (one-pending guard)", async () => {
    const first = await request(app)
      .post("/api/data-exports")
      .set("Authorization", `Bearer ${jwtA1}`);
    expect(first.status).toBe(202);
    expect(first.body).toMatchObject({ status: "queued", scope: "user_self" });
    expect(first.body.jobId).toBeTruthy();

    const second = await request(app)
      .post("/api/data-exports")
      .set("Authorization", `Bearer ${jwtA1}`);
    expect(second.status).toBe(409);
    expect(second.body.error).toBe("export_already_pending");
  });

  it("rejects a raw machine API key (no user identity) with 403 jwt_required", async () => {
    const res = await request(app)
      .post("/api/data-exports")
      .set("X-Api-Key", seed.orgA.apiKey);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("jwt_required");
  });
});

describe("authenticated download (GET /api/data-exports/:fileId/download)", () => {
  let fileA1: SeededExport;

  beforeAll(async () => {
    fileA1 = await seedExportFile(seed.orgA.id, userA1.id);
  });

  it("lets the owner download their own export → 302 to a signed URL for its own object", async () => {
    const res = await request(app)
      .get(`/api/data-exports/${fileA1.fileId}/download`)
      .set("Authorization", `Bearer ${jwtA1}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain(`${fileA1.jobId}.zip`);
    expect(res.headers.location).toContain(seed.orgA.id);
  });

  it("returns 404 for a DIFFERENT user in the SAME org (no cross-user IDOR)", async () => {
    const res = await request(app)
      .get(`/api/data-exports/${fileA1.fileId}/download`)
      .set("Authorization", `Bearer ${jwtA2}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("export_not_found");
  });

  it("returns 404 for a user in ANOTHER org (no cross-org IDOR)", async () => {
    const res = await request(app)
      .get(`/api/data-exports/${fileA1.fileId}/download`)
      .set("Authorization", `Bearer ${jwtB1}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("export_not_found");
  });

  it("surfaces the owner's ready export in the list, scoped to them", async () => {
    const mine = await request(app)
      .get("/api/data-exports")
      .set("Authorization", `Bearer ${jwtA1}`);
    expect(mine.status).toBe(200);
    const ids = (mine.body.exports as Array<{ file: { id: string } | null }>)
      .map((e) => e.file?.id)
      .filter(Boolean);
    expect(ids).toContain(fileA1.fileId);

    // userA2 (same org, no exports) must not see userA1's file.
    const other = await request(app)
      .get("/api/data-exports")
      .set("Authorization", `Bearer ${jwtA2}`);
    expect(other.status).toBe(200);
    const otherIds = (other.body.exports as Array<{ file: { id: string } | null }>)
      .map((e) => e.file?.id)
      .filter(Boolean);
    expect(otherIds).not.toContain(fileA1.fileId);
  });
});

describe("tokenized download (GET /api/data-exports/download?token=…)", () => {
  let fileA: SeededExport;
  let fileB: SeededExport;
  let expiredFile: SeededExport;

  beforeAll(async () => {
    fileA = await seedExportFile(seed.orgA.id, userA1.id);
    fileB = await seedExportFile(seed.orgB.id, userB1.id);
    expiredFile = await seedExportFile(seed.orgA.id, userA1.id, {
      expiresAt: new Date(Date.now() - 60_000),
    });
  });

  it("resolves a valid token to a signed URL for ONLY its own row's object", async () => {
    const res = await request(app)
      .get("/api/data-exports/download")
      .query({ token: fileA.token });
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain(`${fileA.jobId}.zip`);
    // Never another tenant's bytes.
    expect(res.headers.location).not.toContain(fileB.jobId);
    expect(res.headers.location).not.toContain(seed.orgB.id);
  });

  it("rejects an expired token → 410 export_expired", async () => {
    const res = await request(app)
      .get("/api/data-exports/download")
      .query({ token: expiredFile.token });
    expect(res.status).toBe(410);
    expect(res.body.error).toBe("export_expired");
  });

  it("returns 404 for an unknown token", async () => {
    const res = await request(app)
      .get("/api/data-exports/download")
      .query({ token: generateDownloadToken() });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("export_not_found");
  });

  it("returns 400 when no token is supplied", async () => {
    const res = await request(app).get("/api/data-exports/download");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("token_required");
  });
});
