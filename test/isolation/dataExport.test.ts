/**
 * dataExport.test.ts — GDPR/CCPA export engine integration test (PR #2b).
 *
 * The first time the streaming executor runs against a REAL Postgres cursor (the
 * unit tests use ArrayRowStreamer). Drops + applies the full migration set, seeds
 * two orgs each with a user + owned content, then runs `runExport` (user_self)
 * with NO injected seams — exercising withTenant + CursorRowStreamer +
 * information_schema probes + the schema_migrations read — into a Buffer sink,
 * and asserts the resulting zip:
 *   • has a manifest.json + one tables/<t>.ndjson per query;
 *   • the NDJSON parses and row counts match;
 *   • the users row OMITS password_hash / totp_secret (secret projection);
 *   • org B's data never appears (actor-scoped self-export isolation).
 *
 * setup.ts points DATABASE_URL at TEST_DATABASE_URL before this module imports,
 * so infra/postgres (which exporter.ts pulls in) boots against the throwaway DB.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Writable } from "node:stream";
import { Pool } from "pg";
import yauzl from "yauzl";

import { bootstrapTestDb, seedUser, type TestDbSeed } from "./testDb.js";
import { runExport } from "../../src/api/services/dataExport/exporter.js";

let seed: TestDbSeed;
let pool: Pool;
let userA: { id: string; email: string };
let userB: { id: string; email: string };

const SCHEMA_VERSION = "20260621_gdpr_foundations";

class BufferSink extends Writable {
  private readonly chunks: Buffer[] = [];
  _write(chunk: Buffer, _enc: BufferEncoding, cb: (e?: Error | null) => void): void {
    this.chunks.push(Buffer.from(chunk));
    cb();
  }
  toBuffer(): Buffer {
    return Buffer.concat(this.chunks);
  }
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
     VALUES ($1, $2, 'high', 'integration seed', 'manual', $3)`,
    [orgId, title, ownerUserId],
  );
}

beforeAll(async () => {
  seed = await bootstrapTestDb();

  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set for the dataExport integration test.");
  pool = new Pool({ connectionString: url, ssl: false });

  userA = await seedUser(pool, seed.orgA.id, { email: "subject-a@example.com", withSecrets: true });
  userB = await seedUser(pool, seed.orgB.id, { email: "subject-b@example.com", withSecrets: true });

  await seedOwnedFinding(seed.orgA.id, userA.id, "ORG_A_FINDING");
  await seedOwnedFinding(seed.orgB.id, userB.id, "ORG_B_FINDING");

  // The harness applies migrations WITHOUT the runMigrations bookkeeping table,
  // so create + populate it to exercise the real schema_version read (Q1).
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

describe("GDPR export engine — user_self against real Postgres", () => {
  it("produces a valid bundle with a manifest and parseable NDJSON", async () => {
    const sink = new BufferSink();
    const result = await runExport({
      subject: { userId: userA.id, userEmail: userA.email, orgId: seed.orgA.id },
      scope: "user_self",
      sink,
      exportId: "99999999-9999-4999-8999-999999999999",
    });

    const entries = await readZip(sink.toBuffer());

    const manifest = JSON.parse(entries.get("manifest.json")!);
    expect(manifest.generator_version).toBe("2.1.0");
    expect(manifest.scope).toBe("user_self");
    expect(manifest.target_user_id).toBe(userA.id);
    expect(manifest.target_organization_id).toBe(seed.orgA.id);
    expect(manifest.schema_version).toBe(SCHEMA_VERSION);

    // Every manifest table has its NDJSON entry, and counts line up.
    for (const t of result.manifest.tables) {
      const body = entries.get(t.file);
      expect(body, t.file).toBeDefined();
      const lines = body!.length === 0 ? [] : body!.trimEnd().split("\n").filter(Boolean);
      expect(lines.length, t.name).toBe(t.row_count);
    }
  });

  it("includes the subject's own users row but OMITS credentials", async () => {
    const sink = new BufferSink();
    await runExport({
      subject: { userId: userA.id, userEmail: userA.email, orgId: seed.orgA.id },
      scope: "user_self",
      sink,
      exportId: "99999999-9999-4999-8999-999999999998",
    });
    const entries = await readZip(sink.toBuffer());

    const usersNdjson = entries.get("tables/users.ndjson")!.trim();
    const userRow = JSON.parse(usersNdjson);
    expect(userRow.id).toBe(userA.id);
    expect(userRow.email).toBe(userA.email);
    // Secret columns must be absent (projected out), not merely null.
    expect(userRow).not.toHaveProperty("password_hash");
    expect(userRow).not.toHaveProperty("totp_secret");
    expect(usersNdjson).not.toContain("SECRET_PASSWORD_HASH");
    expect(usersNdjson).not.toContain("SECRET_TOTP_SEED");
  });

  it("exports the subject's authored content and never org B's", async () => {
    const sink = new BufferSink();
    const result = await runExport({
      subject: { userId: userA.id, userEmail: userA.email, orgId: seed.orgA.id },
      scope: "user_self",
      sink,
      exportId: "99999999-9999-4999-8999-999999999997",
    });
    const bundle = sink.toBuffer();
    const entries = await readZip(bundle);

    const findings = entries.get("tables/findings.ndjson")!;
    expect(findings).toContain("ORG_A_FINDING");
    expect(findings).not.toContain("ORG_B_FINDING");

    const findingsEntry = result.manifest.tables.find((t) => t.name === "findings")!;
    expect(findingsEntry.row_count).toBe(1);

    // Belt-and-suspenders: org B's user/finding never appear anywhere in the bundle.
    const whole = bundle.toString("latin1");
    expect(whole).not.toContain("ORG_B_FINDING");
    expect(whole).not.toContain(userB.email);
  });
});
