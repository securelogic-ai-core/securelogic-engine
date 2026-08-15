/**
 * seed-professional-org.ts — a dedicated PROFESSIONAL-tier staging tenant.
 *
 * WHY THIS EXISTS
 * ---------------
 * Walkthrough §2.5 asserts that Ask never routes a lower-tier user to a
 * platform-gated surface (LC-2 corpus filtering). It could not be executed,
 * because every seeded staging tenant sits at `platform`:
 *
 *   seed-walkthrough-org.ts  → entitlement_level 'platform'
 *   seed-demo.ts             → 'premium', and Demo is not a Staging substitute
 *   seed-staging.ts          → creates no org and no password users
 *
 * Asking a PLATFORM user a platform question and watching it succeed proves
 * nothing about entitlement filtering. This seeds the missing side of the
 * boundary: a real tenant at `professional` (rank 2), with a real login, and
 * enough of its own data that Ask has something legitimate to retrieve — so a
 * refusal is evidence of filtering rather than evidence of an empty tenant.
 *
 * WHAT MAKES THE TEST DISCRIMINATING
 * ----------------------------------
 * Both halves must be observable, or a pass is meaningless:
 *
 *   AUTHORIZED   Vendors and findings belong to this org. Ask must answer
 *                these, with numbers matching the product surfaces.
 *   WITHHELD     194 routes sit behind requireEntitlement("premium"). This org
 *                is rank 2, so every one of them must deny it — and Ask must
 *                neither answer from them nor recommend them.
 *
 * Nothing here creates or weakens a gate. The platform-only surfaces already
 * exist globally; what this script provides is an identity that legitimately
 * fails to clear them. `core_platform_capability` and
 * `enterprise_context_capability` are deliberately FALSE — setting them TRUE
 * on a professional org would hand it platform surfaces and destroy the very
 * boundary under test.
 *
 * CREDENTIALS — NEVER HARD-CODED
 * ------------------------------
 * The password is read from PROFESSIONAL_SEED_PASSWORD and has NO default.
 * The script refuses to run without it, so no plaintext credential is ever
 * committed to this repository. It is stored only as an argon2 hash.
 * (seed-walkthrough-org.ts carries a literal default; this one deliberately
 * does not, and the two are not required to match.)
 *
 * SAFETY
 * ------
 * - Refuses outright if connected to the production database.
 * - Refuses if the target email already belongs to a DIFFERENT organization
 *   (users.email is globally unique, so an upsert could otherwise cross a
 *   tenant boundary).
 * - Deterministic and rerunnable: every write is an upsert keyed on a stable
 *   natural key. Re-running converges on the same tenant; it does not
 *   accumulate rows.
 *
 * USAGE
 *   PROFESSIONAL_SEED_PASSWORD='…' tsx scripts/validation/seed-professional-org.ts
 *   …                                                                   --summary
 *   …                                                                   --reset
 *   …                                                                   --teardown
 */
import { config } from "dotenv";
import { pathToFileURL } from "node:url";
import argon2 from "argon2";
import { Pool, type PoolClient } from "pg";

import { recordAllCurrentConsents } from "../../src/api/lib/legalConsent.js";

config();

// ─── Constants ───────────────────────────────────────────────────────────────

const PROD_DB_NAME = "securelogic";

const PRO_NAME = "[SEED] Professional Tier Org";
const PRO_SLUG = "seed-professional";
const PRO_KEY_LABEL = "[SEED] Professional Key";

const PRO_EMAIL = "professional-user@seed.securelogicai.test";
const PRO_USER_NAME = "[SEED] Professional User";

/**
 * The tier under test. `professional` is rank 2 in requireEntitlement's
 * lattice; `premium` (rank 4) is what platform surfaces demand. Chosen over
 * `starter` (rank 1) because it exercises the BOUNDARY rather than the floor:
 * a starter user fails a rank-2 gate too, so a starter pass would not prove
 * the platform gate specifically.
 */
const PRO_ENTITLEMENT = "professional";

const SUMMARY_ONLY = process.argv.includes("--summary");
const RESET = process.argv.includes("--reset");
const TEARDOWN_ONLY = process.argv.includes("--teardown");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost") ? false : { rejectUnauthorized: false },
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** INSERT … ON CONFLICT DO NOTHING RETURNING id, falling back to a SELECT. */
async function upsertId(
  c: PoolClient,
  insertSql: string,
  insertParams: unknown[],
  selectSql: string,
  selectParams: unknown[]
): Promise<string> {
  const ins = await c.query<{ id: string }>(insertSql, insertParams);
  if (ins.rows[0]?.id) return ins.rows[0].id;
  const sel = await c.query<{ id: string }>(selectSql, selectParams);
  const id = sel.rows[0]?.id;
  if (!id) throw new Error(`upsertId: no row after insert-or-select:\n${selectSql}`);
  return id;
}

/**
 * The org. entitlement_level AND plan are both 'professional', and the two
 * platform capability flags are FALSE — this tenant must not clear a platform
 * gate by any route.
 *
 * require_mfa is forced FALSE for the same reason the walkthrough seed does it:
 * customerAuth blocks login outright when the org requires MFA and the user has
 * not enrolled, which would make the seeded credential unusable.
 */
async function ensureProfessionalOrg(c: PoolClient): Promise<string> {
  const orgId = await upsertId(
    c,
    `INSERT INTO organizations
       (name, slug, plan, status, entitlement_level, scale, regulated, handles_pii,
        max_monitored_entities, enterprise_context_capability, core_platform_capability)
     VALUES ($1, $2, $3, 'active', $3, 'Small', FALSE, TRUE, 25, FALSE, FALSE)
     ON CONFLICT (slug) DO NOTHING RETURNING id`,
    [PRO_NAME, PRO_SLUG, PRO_ENTITLEMENT],
    `SELECT id FROM organizations WHERE slug = $1`,
    [PRO_SLUG]
  );

  // Re-assert on an existing org, so a rerun REPAIRS drift rather than
  // inheriting whatever a previous experiment left behind. If someone has
  // promoted this org to platform, this puts it back.
  await c.query(
    `UPDATE organizations
        SET entitlement_level             = $2,
            plan                          = $2,
            status                        = 'active',
            enterprise_context_capability = FALSE,
            core_platform_capability      = FALSE,
            require_mfa                   = FALSE,
            updated_at                    = NOW()
      WHERE id = $1`,
    [orgId, PRO_ENTITLEMENT]
  );
  return orgId;
}

/**
 * The user. Role is `admin` DELIBERATELY: §2.5 tests the ENTITLEMENT boundary,
 * not the role boundary. A member/analyst who is refused a platform surface
 * proves nothing — the refusal could be the role gate. An org admin who is
 * still refused can only have been stopped by the tier.
 */
async function ensureProfessionalUser(
  c: PoolClient,
  orgId: string,
  passwordHash: string
): Promise<string> {
  await c.query(
    `INSERT INTO users
       (organization_id, email, name, role, status, password_hash, email_verified)
     VALUES ($1, $2, $3, 'admin', 'active', $4, TRUE)
     ON CONFLICT (email) DO UPDATE
        SET name                  = EXCLUDED.name,
            role                  = 'admin',
            status                = 'active',
            password_hash         = EXCLUDED.password_hash,
            email_verified        = TRUE,
            failed_login_attempts = 0,
            lockout_until         = NULL,
            last_failed_login_at  = NULL,
            totp_enabled          = FALSE,
            totp_secret           = NULL,
            deleted_at            = NULL,
            deletion_scheduled_at = NULL
      WHERE users.organization_id = $1`,
    [orgId, PRO_EMAIL, PRO_USER_NAME, passwordHash]
  );

  const sel = await c.query<{ id: string }>(
    `SELECT id FROM users WHERE email = $1 AND organization_id = $2`,
    [PRO_EMAIL, orgId]
  );
  const id = sel.rows[0]?.id;
  if (!id) {
    // users.email is globally unique, so the upsert above is a no-op when the
    // address lives in another tenant. Failing loudly beats seeding nothing.
    throw new Error(
      `REFUSING TO SEED: ${PRO_EMAIL} already exists in a DIFFERENT organization. ` +
        `Resolve the collision before re-running.`
    );
  }
  return id;
}

/** Minimum realistic tenant-scoped data, so a refusal is filtering, not emptiness. */
async function seedTenantData(c: PoolClient, orgId: string, userId: string): Promise<void> {
  const vendors: Array<[string, string, string, string, string, number]> = [
    ["Northwind Payments", "Payments", "high", "confidential", "limited", 58],
    ["Contoso Analytics", "Analytics", "medium", "internal", "read_only", 34],
  ];
  const vendorIds: string[] = [];
  for (const [name, category, criticality, sensitivity, access, score] of vendors) {
    vendorIds.push(
      await upsertId(
        c,
        `INSERT INTO vendors (organization_id, name, category, criticality, data_sensitivity,
                              access_level, service_description, status, owner_user_id,
                              current_risk_score)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', $8, $9)
         ON CONFLICT (organization_id, name) DO NOTHING RETURNING id`,
        [orgId, name, category, criticality, sensitivity, access,
         `[SEED] ${name} — professional-tier walkthrough vendor`, userId, score],
        `SELECT id FROM vendors WHERE organization_id = $1 AND name = $2`,
        [orgId, name]
      )
    );
  }

  // Findings across severities so a count question has a non-trivial answer.
  const findings: Array<[string, string, string, number]> = [
    ["Payment webhook endpoint lacks signature verification", "Critical", "Vendor Risk", 7],
    ["Analytics export retains PII beyond the stated window", "High", "Privacy", 21],
    ["Vendor SOC 2 report is more than 12 months old", "Medium", "Vendor Risk", 45],
    ["MFA not enforced for two vendor admin accounts", "High", "Identity", 14],
  ];
  for (const [title, severity, domain, dueOffset] of findings) {
    const vendorId = vendorIds[0];
    // `findings` carries NO unique constraint, so ON CONFLICT cannot dedupe here
    // and a rerun would silently double the tenant's findings — which would also
    // corrupt the §2.5 count comparison. Guard on (organization_id, title)
    // explicitly instead; the titles are stable, so this converges.
    await c.query(
      `INSERT INTO findings
         (organization_id, title, severity, description, recommendation, source_type, source_id,
          domain, priority, likelihood, confidence, time_sensitivity, owner_user_id, due_date,
          decision_state, status)
       SELECT $1, $2, $3, $4, $5, 'vendor_assessment', $6, $7, 'near_term', 'likely',
              'high', 'near_term', $8, CURRENT_DATE + ($9)::int, 'needs_review', 'open'
        WHERE NOT EXISTS (
          SELECT 1 FROM findings WHERE organization_id = $1 AND title = $2
        )`,
      [orgId, `[SEED] ${title}`, severity,
       `[SEED] Professional-tier finding used to prove Ask answers this tenant's OWN data.`,
       `[SEED] Remediate and evidence.`, vendorId, domain, userId, dueOffset]
    );
  }
}

/** Everything this seed owns, for --reset and --teardown. Order respects FKs. */
async function deleteTenantData(c: PoolClient, orgId: string): Promise<void> {
  await c.query(`DELETE FROM findings WHERE organization_id = $1 AND title LIKE '[SEED]%'`, [orgId]);
  await c.query(`DELETE FROM vendors  WHERE organization_id = $1 AND service_description LIKE '[SEED]%'`, [orgId]);
}

async function printSummary(c: PoolClient, orgId: string): Promise<void> {
  const org = await c.query(
    `SELECT name, slug, plan, entitlement_level, status,
            core_platform_capability, enterprise_context_capability, require_mfa
       FROM organizations WHERE id = $1`,
    [orgId]
  );
  const key = await c.query(
    `SELECT label, entitlement_level, status FROM api_keys WHERE organization_id = $1`,
    [orgId]
  );
  const usr = await c.query(
    `SELECT email, role, status, email_verified, (password_hash IS NOT NULL) AS has_password
       FROM users WHERE organization_id = $1`,
    [orgId]
  );
  const consents = await c.query(
    `SELECT count(*)::int AS n FROM legal_consents
      WHERE user_id IN (SELECT id FROM users WHERE organization_id = $1)`,
    [orgId]
  );
  const counts = await c.query(
    `SELECT (SELECT count(*)::int FROM vendors  WHERE organization_id = $1) AS vendors,
            (SELECT count(*)::int FROM findings WHERE organization_id = $1) AS findings`,
    [orgId]
  );
  console.log("\n  ORG      :", JSON.stringify(org.rows[0], null, 1));
  console.log("  API KEY  :", JSON.stringify(key.rows[0] ?? null));
  console.log("  USER     :", JSON.stringify(usr.rows[0] ?? null));
  console.log("  CONSENTS :", consents.rows[0]?.n ?? 0, "(3 expected: terms, privacy, ai)");
  console.log("  DATA     :", JSON.stringify(counts.rows[0]));
  console.log(`\n  Password : set via PROFESSIONAL_SEED_PASSWORD (never printed, never committed)\n`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const password = process.env.PROFESSIONAL_SEED_PASSWORD;
  if (!SUMMARY_ONLY && !TEARDOWN_ONLY && (!password || password.length < 12)) {
    throw new Error(
      "REFUSING TO RUN: set PROFESSIONAL_SEED_PASSWORD (>= 12 chars). " +
        "This script has no default password by design — no plaintext credential " +
        "is committed to this repository."
    );
  }

  const c = await pool.connect();
  try {
    // Prod guard — outside the transaction, fail before anything opens.
    const db = await c.query<{ db: string }>(`SELECT current_database() AS db`);
    const dbName = db.rows[0]!.db;
    if (dbName === PROD_DB_NAME) {
      throw new Error(
        `REFUSING TO RUN: connected to the production database ('${dbName}'). ` +
          `This script only runs against staging.`
      );
    }
    console.log(`\n  Database : ${dbName}  (not prod — OK)`);

    await c.query("BEGIN");
    const orgId = await ensureProfessionalOrg(c);
    console.log(`  Org      : ${PRO_NAME} (${PRO_SLUG}) [${orgId}]`);
    await c.query(`SELECT set_config('app.current_org_id', $1, true)`, [orgId]);

    if (SUMMARY_ONLY) {
      await printSummary(c, orgId);
      await c.query("ROLLBACK");
      console.log("  Mode     : --summary (nothing written)\n");
      return;
    }

    if (RESET || TEARDOWN_ONLY) {
      await deleteTenantData(c, orgId);
      console.log(`  Mode     : ${TEARDOWN_ONLY ? "--teardown" : "--reset"} (seed data removed)`);
      if (TEARDOWN_ONLY) {
        await c.query("COMMIT");
        console.log("  Org, user and key left in place (teardown removes DATA only).\n");
        return;
      }
    }

    const passwordHash = await argon2.hash(password!);
    const userId = await ensureProfessionalUser(c, orgId, passwordHash);
    console.log(`  User     : ${PRO_EMAIL} (admin) [${userId}]`);

    // requireConsent gates every authenticated human session — without these the
    // login succeeds and then every route 403s consent_required.
    await recordAllCurrentConsents(c, {
      userId,
      organizationId: orgId,
      consentMethod: "admin_recorded",
    });

    // An ACTIVE api_keys row is mandatory for SESSION auth (requireApiKey looks
    // up the org's active key on every request). Its entitlement_level is set to
    // the SAME tier as the org: a split between the two would make the tenant
    // clear one gate and fail another, and the test would prove nothing.
    // key_hash is a non-secret placeholder — this row is never used to
    // authenticate, only to satisfy the active-key lookup.
    await upsertId(
      c,
      `INSERT INTO api_keys (organization_id, label, key_hash, entitlement_level, status,
                             created_by_user_id)
       VALUES ($1, $2, $3, $4, 'active', $5)
       ON CONFLICT DO NOTHING RETURNING id`,
      [orgId, PRO_KEY_LABEL, `seed-professional-not-for-auth-${orgId}`, PRO_ENTITLEMENT, userId],
      `SELECT id FROM api_keys WHERE organization_id = $1 AND label = $2`,
      [orgId, PRO_KEY_LABEL]
    );
    // Re-assert tier + status on rerun, so drift is repaired rather than kept.
    await c.query(
      `UPDATE api_keys SET entitlement_level = $2, status = 'active'
        WHERE organization_id = $1 AND label = $3`,
      [orgId, PRO_ENTITLEMENT, PRO_KEY_LABEL]
    );

    await seedTenantData(c, orgId, userId);
    await printSummary(c, orgId);
    await c.query("COMMIT");
    console.log("  Committed.\n");
  } catch (err) {
    await c.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    c.release();
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("\n  FAILED:", err instanceof Error ? err.message : err, "\n");
    process.exit(1);
  });
}

export { main, ensureProfessionalOrg, PRO_SLUG, PRO_EMAIL, PRO_ENTITLEMENT };
