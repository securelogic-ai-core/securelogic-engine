/**
 * scripts/validation/seed-walkthrough-org.ts
 *
 * Deterministic, human-scale walkthrough dataset for ONE dedicated staging org.
 *
 * PURPOSE
 *   Make every panel of the core walkthrough — Brief → Finding → Decision
 *   Workspace → Links → Evidence → Remediation → status update — light up from
 *   REAL rows, at a size a human can verify by eye (2 vendors, 5 assets,
 *   8 findings, 4 actions, 2 evidence records, 3 risks).
 *
 *   It is also a DISCRIMINATOR. The finding set is deliberately spread across
 *   five source_types so that panels which render empty do so for a *knowable*
 *   reason. After seeding, an empty panel is either a proven code defect or a
 *   proven honest-empty state — never "maybe it's just missing data".
 *
 *     F1/F2  cyber_signal      → all four affected buckets + intelligence +
 *                                candidates resolve; F1↔F2 share a source_id so
 *                                Related Findings has a TRUE POSITIVE.
 *     F3     intelligence_event→ Related Findings is STRUCTURALLY 0 (a partial
 *                                unique index forbids a second row), proving the
 *                                zero is a code defect, not a data gap.
 *     F4/F5  control_test      → assessment resolution path; share a source_id,
 *                                so Related Findings works here too.
 *     F6     vendor_review     → vendor resolved via the assessment record.
 *     F8     manual            → source_id IS NULL; every bucket is honestly
 *                                "not applicable". The floor state.
 *
 * SAFETY
 *   - Refuses to run against prod (current_database = 'securelogic').
 *   - Refuses to touch the dogfood org.
 *   - Operates ONLY on the org with slug WALKTHROUGH_SLUG (created if absent),
 *     or an --org-id you pass explicitly.
 *   - Everything runs in ONE transaction. Any error rolls the whole thing back.
 *
 * USAGE (staging Render shell — devDependencies incl. tsx are installed there
 * by `npm ci --include=dev`, and DATABASE_URL is already in the environment):
 *
 *   npx tsx scripts/validation/seed-walkthrough-org.ts              # seed / re-seed (idempotent)
 *   npx tsx scripts/validation/seed-walkthrough-org.ts --reset      # teardown, then seed
 *   npx tsx scripts/validation/seed-walkthrough-org.ts --teardown   # teardown only
 *   npx tsx scripts/validation/seed-walkthrough-org.ts --summary    # print state, write nothing
 *   npx tsx scripts/validation/seed-walkthrough-org.ts --org-id <uuid>   # target an existing org
 *
 * FEATURE FLAGS — the walkthrough is invisible without these on the staging engine
 * AND the staging Next app (see render.yaml):
 *   SECURELOGIC_DECISION_WORKSPACE_ENABLED=true   (gates GET /api/findings/:id/context)
 *   SECURELOGIC_INTELLIGENCE_EVENTS_ENABLED=true  (gates the event-native channel)
 *   SECURELOGIC_RISK_ACCEPTANCE_ENABLED=true      (gates the accepted-risk routes;
 *                                                  already "true" on engine-staging,
 *                                                  OFF on prod. Routes 404 while off.)
 *
 * CREDENTIALS — both walkthrough users carry a real argon2 password, because the
 * accepted-risk API refuses api-key identity and needs two distinct SESSION users
 * (proposer, approver). `--summary` prints the emails, roles and test password; it
 * never prints a hash. See WALKTHROUGH_PASSWORD below.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NAMING — read this before objecting to the absence of a [SEED] prefix
 *
 * Findings, actions, evidence, assessments and the org itself are prefixed
 * "[SEED]". Entity NAMES (vendors, AI systems, controls, obligations, and the
 * asset rows backing SharePoint/Exchange/Defender/Catalyst SD-WAN) are NOT.
 *
 * They cannot be. Three separate resolvers match on the name string itself:
 *   1. findingContextResolver.ts — event-native vendor match is
 *      `lower(trim(vendors.name)) = lower(trim(intelligence_events.affected_vendor))`
 *   2. tenantAssetResolver.ts — matches `canonicalizeVendorName(asset.name)`
 *      against a canonical product key
 *   3. findingEntitySearch.ts — ILIKE over vendors.name / controls.name /
 *      obligations.title
 * Prefixing would canonicalize "Microsoft" to "seed microsoft" and every one of
 * those joins would silently return zero — the seed would manufacture the exact
 * false negatives it exists to rule out.
 *
 * Tenant isolation is the org_id boundary, not a string prefix. This mirrors the
 * existing precedent in scripts/seed-staging.ts, which prefixes findings/risks
 * but leaves matcher-visible entity names clean, for the same reason.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * SCHEMA REALITY — two requested items DO NOT EXIST and are not seeded:
 *   - CIA ratings (confidentiality/integrity/availability): no such columns on
 *     any asset table. Asset business impact is modelled solely as `criticality`.
 *   - A vendor→product ATTESTATION table: there is none. The closest real,
 *     FK-backed structures are used instead — `dependencies` (vendor_id → named
 *     product, with criticality) and `enterprise_relationships` (asset →vendor
 *     edges). `canonical_products` is populated too, but nothing in a live read
 *     path consumes it yet.
 *
 * CVEs are deliberately SYNTHETIC (CVE-2026-9000x). They must never be mistaken
 * for real advisories.
 */

import { config } from "dotenv";

// .env.local wins over .env; a shell-provided DATABASE_URL wins over both.
config({ path: ".env.local" });
config({ path: ".env" });

import { pathToFileURL } from "node:url";
import argon2 from "argon2";
import { Pool, type PoolClient } from "pg";
// The PRODUCTION canonicalizer — imported, never re-implemented, so seeded
// canonical_key values cannot drift from what the resolver computes at runtime.
import { canonicalizeVendorName } from "../../src/api/lib/vendorNameCanonical.js";

// ─── Config ──────────────────────────────────────────────────────────────────

export const WALKTHROUGH_SLUG = "seed-walkthrough";
const WALKTHROUGH_NAME = "[SEED] Walkthrough Org";
const PROD_DB_NAME = "securelogic";

export const ANALYST_EMAIL = "walkthrough-analyst@seed.securelogicai.test";
export const APPROVER_EMAIL = "walkthrough-approver@seed.securelogicai.test";

/**
 * CREDENTIALS — these two users exist to make the accepted-risk lifecycle
 * exercisable. The API defines "approver" purely as *a different user_id than the
 * proposer*: riskAcceptances.ts gates on the feature flag, requireEntitlement
 * ("premium"), and a separation-of-duties check (approver !== requested_by), and
 * carries NO role gate. It also REFUSES api-key identity outright — propose returns
 * 403 user_identity_required without a session user. So a real password, and a real
 * login, is the only way to drive this flow.
 *
 * Roles are least-privilege for that lifecycle, not copied from each other:
 *   proposer = 'member'  — can authenticate and propose; cannot reach the only
 *                          admin-gated routes in the app (teamInvites.ts, sso.ts).
 *   approver = 'admin'   — the governance signer. Matches the precondition in
 *                          docs/validation/risk-lifecycle-r3-staging-walkthrough.md.
 * Separation of duties is preserved structurally: they are two distinct user rows,
 * so the proposer cannot approve its own request (403, and a DB CHECK behind that).
 *
 * The password is a STAGING TEST CREDENTIAL for a [SEED] org on a non-prod database
 * — never a production secret. It is deterministic so a walkthrough is repeatable,
 * and overridable via WALKTHROUGH_SEED_PASSWORD. The prod guard in main() means
 * these rows cannot be written to the production database at all.
 */
const WALKTHROUGH_PASSWORD = process.env.WALKTHROUGH_SEED_PASSWORD ?? "Walkthrough!Seed2026";

const PROPOSER_ROLE = "member";
const APPROVER_ROLE = "admin";

const RESET = process.argv.includes("--reset");
const TEARDOWN_ONLY = process.argv.includes("--teardown");
const SUMMARY_ONLY = process.argv.includes("--summary");

const orgIdFlagIdx = process.argv.indexOf("--org-id");
const ORG_ID_ARG = orgIdFlagIdx !== -1 ? process.argv[orgIdFlagIdx + 1] : undefined;

// Synthetic CVEs — never real advisories.
const CVE_SHAREPOINT = "CVE-2026-90001";
const CVE_EXCHANGE = "CVE-2026-90002";
const CVE_SDWAN = "CVE-2026-90003";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL not set.");
  console.error("Run this in the staging Render shell, where DATABASE_URL is already present.");
  process.exit(1);
}

// Render's managed Postgres requires SSL; a local/containerised Postgres does not
// offer it at all, and forcing `ssl` there fails the connect outright.
const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(DATABASE_URL);

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: isLocal ? undefined : { rejectUnauthorized: false },
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** INSERT ... RETURNING id, or fetch the existing id — for tables with a usable unique key. */
async function upsertId(
  c: PoolClient,
  sql: string,
  params: unknown[],
  selectSql: string,
  selectParams: unknown[]
): Promise<string> {
  const ins = await c.query(sql, params);
  if (ins.rows[0]?.id) return String(ins.rows[0].id);
  const sel = await c.query(selectSql, selectParams);
  if (!sel.rows[0]?.id) throw new Error(`upsertId: could not resolve id.\nSQL: ${sql}`);
  return String(sel.rows[0].id);
}

/**
 * Create-or-reuse a walkthrough user with a working password.
 *
 * `users.email` is GLOBALLY unique, not unique-per-org. A bare
 * `ON CONFLICT (email) DO UPDATE` would therefore happily overwrite a user in a
 * DIFFERENT tenant if these seed addresses ever collided — and the old
 * `DO NOTHING` + blind re-SELECT was worse: it would have silently returned that
 * other tenant's user id and attributed every seeded row to them. So the update is
 * guarded by organization_id, and the id is re-read with the org in the predicate.
 * If the email is held by another org we resolve nothing and throw, rather than
 * reach across the tenant boundary.
 *
 * Re-seeding must also RECOVER a user an operator has broken: a wrong-password
 * lockout, an unverified email, an MFA enrolment, or a scheduled deletion would all
 * leave the account unable to log in. Each of those is reset here, which is what
 * makes "rerun the seed" a reliable fix rather than a no-op.
 *
 * The password hash is never returned and never logged.
 */
async function ensureWalkthroughUser(
  c: PoolClient,
  orgId: string,
  email: string,
  name: string,
  role: string,
  passwordHash: string
): Promise<string> {
  await c.query(
    `INSERT INTO users
       (organization_id, email, name, role, status, password_hash, email_verified)
     VALUES ($1, $2, $3, $4, 'active', $5, TRUE)
     ON CONFLICT (email) DO UPDATE
        SET name                  = EXCLUDED.name,
            role                  = EXCLUDED.role,
            status                = 'active',
            password_hash         = EXCLUDED.password_hash,
            email_verified        = TRUE,
            -- Recover an account an operator locked out or half-enrolled.
            failed_login_attempts = 0,
            lockout_until         = NULL,
            last_failed_login_at  = NULL,
            totp_enabled          = FALSE,
            totp_secret           = NULL,
            deleted_at            = NULL,
            deletion_scheduled_at = NULL
      WHERE users.organization_id = $1`,
    [orgId, email, name, role, passwordHash]
  );

  const sel = await c.query<{ id: string }>(
    `SELECT id FROM users WHERE email = $1 AND organization_id = $2`,
    [email, orgId]
  );
  const id = sel.rows[0]?.id;
  if (!id) {
    throw new Error(
      `REFUSING TO SEED: ${email} already exists in a DIFFERENT organization. ` +
        `Walkthrough users must belong to the walkthrough org (${orgId}). ` +
        `Resolve the collision before re-running.`
    );
  }
  return String(id);
}

/** SELECT-then-INSERT, for the several tables that carry NO unique constraint. */
async function ensureRow(
  c: PoolClient,
  selectSql: string,
  selectParams: unknown[],
  insertSql: string,
  insertParams: unknown[]
): Promise<string> {
  const sel = await c.query(selectSql, selectParams);
  if (sel.rows[0]?.id) return String(sel.rows[0].id);
  const ins = await c.query(insertSql, insertParams);
  return String(ins.rows[0].id);
}

/** Register a backing row in the Tier-0 asset spine and set its back-pointer. */
async function ensureAsset(
  c: PoolClient,
  orgId: string,
  assetType: string,
  backingKind: string,
  backingId: string
): Promise<string> {
  const assetId = await upsertId(
    c,
    `INSERT INTO assets (organization_id, asset_type, backing_kind, backing_id, lifecycle_status)
     VALUES ($1, $2, $3, $4, 'active')
     ON CONFLICT (organization_id, backing_kind, backing_id) DO NOTHING
     RETURNING id`,
    [orgId, assetType, backingKind, backingId],
    `SELECT id FROM assets
      WHERE organization_id = $1 AND backing_kind = $2 AND backing_id = $3`,
    [orgId, backingKind, backingId]
  );
  // Every backing table that carries an asset_id back-pointer.
  if (["vendors", "ai_systems", "enterprise_entities", "endpoints"].includes(backingKind)) {
    await c.query(`UPDATE ${backingKind} SET asset_id = $1 WHERE id = $2 AND organization_id = $3`, [
      assetId,
      backingId,
      orgId,
    ]);
  }
  return assetId;
}

/** asset → vendor edge. from_id is the ASSETS row id, not the backing row id. */
async function ensureEdge(
  c: PoolClient,
  orgId: string,
  fromAssetId: string,
  toVendorId: string,
  relationshipType: string,
  note: string
): Promise<void> {
  await c.query(
    `INSERT INTO enterprise_relationships
       (organization_id, from_type, from_id, to_type, to_id, relationship_type, note)
     VALUES ($1, 'asset', $2, 'vendor', $3, $4, $5)
     ON CONFLICT (organization_id, from_type, from_id, to_type, to_id, relationship_type)
       WHERE deleted_at IS NULL
       DO NOTHING`,
    [orgId, fromAssetId, toVendorId, relationshipType, note]
  );
}

/** Global canonical product, keyed exactly as canonicalProductIdentity() builds it. */
async function ensureCanonicalProduct(
  c: PoolClient,
  vendorRaw: string,
  productRaw: string
): Promise<string> {
  const vendorCanonical = canonicalizeVendorName(vendorRaw);
  const productCanonical = canonicalizeVendorName(productRaw);
  const canonicalKey = [vendorCanonical, productCanonical, ""].join("|");

  const id = await upsertId(
    c,
    `INSERT INTO canonical_products (canonical_key, vendor_canonical, product_canonical, display_name)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (canonical_key) DO NOTHING
     RETURNING id`,
    [canonicalKey, vendorCanonical, productCanonical, `${vendorRaw} ${productRaw}`],
    `SELECT id FROM canonical_products WHERE canonical_key = $1`,
    [canonicalKey]
  );

  await c.query(
    `INSERT INTO canonical_product_aliases (product_id, alias_raw, alias_canonical, source)
     VALUES ($1, $2, $3, 'seed_walkthrough')
     ON CONFLICT (product_id, alias_canonical, source) DO NOTHING`,
    [id, productRaw, productCanonical]
  );
  return id;
}

// ─── Teardown ────────────────────────────────────────────────────────────────

/**
 * The six append-only (WORM) tables, each guarded by a BEFORE UPDATE OR DELETE
 * FOR EACH ROW trigger that unconditionally RAISEs — no role or session-var
 * escape hatch.
 *
 * THIS IS LOAD-BEARING, AND IT EXPOSES A REAL PLATFORM DEFECT. Postgres fires
 * row triggers on FK *cascade* deletes. `finding_lifecycle_events.finding_id`
 * is ON DELETE CASCADE, so `DELETE FROM findings` RAISEs as soon as one
 * lifecycle event exists — and `organization_id` is ON DELETE CASCADE too, so
 * `DELETE FROM organizations` RAISEs for the same reason. Tenant offboarding
 * and GDPR erasure are therefore impossible for any org whose findings have
 * ever been decided on. Verified against a real database, not inferred.
 * Reported separately; the fix belongs in the trigger, not here.
 */
const WORM_TRIGGERS: Array<[table: string, trigger: string]> = [
  // A risk acceptance is a governance artifact: the product's answer to "undo" is
  // withdraw (state='withdrawn'), never DELETE, and a BEFORE DELETE trigger enforces
  // that. Correct for the product, and NOT changed. But it makes the seed org
  // permanently un-reseedable once a walkthrough has proposed anything, so the
  // explicitly-invoked validation teardown disables it for the span of one
  // transaction — exactly as it already does for the six tables below.
  ["finding_risk_acceptances", "trg_finding_risk_acceptances_forbid_delete"],
  ["finding_lifecycle_events", "prevent_finding_lifecycle_events_row_mutation"],
  ["security_audit_log", "prevent_security_audit_log_row_mutation"],
  ["risk_lifecycle_events", "prevent_risk_lifecycle_events_row_mutation"],
  ["applicability_assessments", "prevent_applicability_assessments_row_mutation"],
  ["applicability_evidence", "prevent_applicability_evidence_row_mutation"],
  ["applicability_affected_entities", "prevent_applicability_affected_entities_row_mutation"],
];

/**
 * Delete every seeded row for this org.
 *
 * The WORM triggers above are disabled for the span of the transaction. DDL is
 * transactional in Postgres, so if anything below fails, the ROLLBACK restores
 * every trigger automatically — they can never be left off, even on a crash.
 * Requires table ownership, which the migration role has.
 */
export async function teardown(c: PoolClient, orgId: string): Promise<void> {
  for (const [table, trigger] of WORM_TRIGGERS) {
    await c.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
  }

  // Append-only streams a human walkthrough may have written into.
  await c.query(`DELETE FROM applicability_affected_entities WHERE organization_id = $1`, [orgId]);
  await c.query(`DELETE FROM applicability_evidence WHERE organization_id = $1`, [orgId]);
  await c.query(`DELETE FROM applicability_assessments WHERE organization_id = $1`, [orgId]);
  await c.query(`DELETE FROM risk_lifecycle_events WHERE organization_id = $1`, [orgId]);
  await c.query(`DELETE FROM risk_treatments WHERE organization_id = $1`, [orgId]);
  await c.query(`DELETE FROM risks WHERE organization_id = $1`, [orgId]);

  // Children first where there is no cascade to rely on.
  await c.query(`DELETE FROM finding_lifecycle_events WHERE organization_id = $1`, [orgId]);
  await c.query(`DELETE FROM finding_review_marks WHERE organization_id = $1`, [orgId]);
  await c.query(`DELETE FROM evidence WHERE organization_id = $1`, [orgId]);
  await c.query(`DELETE FROM actions WHERE organization_id = $1`, [orgId]);
  await c.query(`DELETE FROM security_audit_log WHERE organization_id = $1`, [orgId]);

  // finding_risk_acceptances.finding_id is ON DELETE RESTRICT — deliberately, so a
  // governed acceptance BLOCKS deletion of the Finding it governs (see
  // 20260907_finding_risk_acceptances.sql:61-73). That FK is correct and is NOT
  // touched here. It does mean the DELETE below RAISEs the moment a walkthrough has
  // actually proposed or approved an acceptance — i.e. exactly once the org has been
  // used for the thing it exists to validate. Clearing the acceptances first is what
  // keeps this org re-seedable; it is scoped to this org and confined to this
  // explicitly-invoked validation teardown. It is NOT a tenant-offboarding path.
  await c.query(`DELETE FROM finding_risk_acceptances WHERE organization_id = $1`, [orgId]);

  await c.query(`DELETE FROM findings WHERE organization_id = $1`, [orgId]);

  await c.query(`DELETE FROM signal_match_suggestions WHERE organization_id = $1`, [orgId]);
  await c.query(`DELETE FROM signal_vendor_links WHERE organization_id = $1`, [orgId]);
  await c.query(`DELETE FROM signal_ai_system_links WHERE organization_id = $1`, [orgId]);
  await c.query(`DELETE FROM signal_control_links WHERE organization_id = $1`, [orgId]);
  await c.query(`DELETE FROM signal_obligation_links WHERE organization_id = $1`, [orgId]);

  // Global intelligence spine: only OUR synthetic canonical keys. Never a blanket delete.
  const keys = [`cve:${CVE_SHAREPOINT}`, `cve:${CVE_EXCHANGE}`, `cve:${CVE_SDWAN}`];
  await c.query(
    `DELETE FROM intelligence_event_sources
      WHERE event_id IN (SELECT id FROM intelligence_events WHERE canonical_key = ANY($1))`,
    [keys]
  );
  await c.query(
    `DELETE FROM intelligence_event_timeline
      WHERE event_id IN (SELECT id FROM intelligence_events WHERE canonical_key = ANY($1))`,
    [keys]
  );
  await c.query(`DELETE FROM intelligence_events WHERE canonical_key = ANY($1)`, [keys]);
  await c.query(`DELETE FROM cyber_signals WHERE organization_id = $1`, [orgId]);

  await c.query(`DELETE FROM control_assessments WHERE organization_id = $1`, [orgId]);
  await c.query(`DELETE FROM vendor_assessments WHERE organization_id = $1`, [orgId]);
  await c.query(`DELETE FROM ai_system_vendor_dependencies WHERE organization_id = $1`, [orgId]);
  await c.query(`DELETE FROM dependencies WHERE organization_id = $1`, [orgId]);
  await c.query(`DELETE FROM enterprise_relationships WHERE organization_id = $1`, [orgId]);

  await c.query(`DELETE FROM control_mappings WHERE control_id IN (SELECT id FROM controls WHERE organization_id = $1)`, [orgId]);
  await c.query(`DELETE FROM requirements WHERE framework_id IN (SELECT id FROM frameworks WHERE organization_id = $1)`, [orgId]);
  await c.query(`DELETE FROM frameworks WHERE organization_id = $1`, [orgId]);

  // Drop asset back-pointers before deleting the spine rows they reference.
  for (const t of ["vendors", "ai_systems", "enterprise_entities"]) {
    await c.query(`UPDATE ${t} SET asset_id = NULL WHERE organization_id = $1`, [orgId]);
  }
  await c.query(`DELETE FROM assets WHERE organization_id = $1`, [orgId]);
  await c.query(`DELETE FROM endpoints WHERE organization_id = $1`, [orgId]);
  await c.query(`DELETE FROM enterprise_entities WHERE organization_id = $1`, [orgId]);
  await c.query(`DELETE FROM controls WHERE organization_id = $1`, [orgId]);
  await c.query(`DELETE FROM obligations WHERE organization_id = $1`, [orgId]);
  await c.query(`DELETE FROM ai_systems WHERE organization_id = $1`, [orgId]);
  await c.query(`DELETE FROM vendors WHERE organization_id = $1`, [orgId]);
  await c.query(`DELETE FROM risk_settings WHERE organization_id = $1`, [orgId]);
  // Before users: api_keys.created_by_user_id is ON DELETE SET NULL, so this is not a
  // FK requirement — but the key is a seeded row and must not survive its own tenant.
  await c.query(`DELETE FROM api_keys WHERE organization_id = $1`, [orgId]);
  await c.query(`DELETE FROM users WHERE organization_id = $1`, [orgId]);

  for (const [table, trigger] of WORM_TRIGGERS) {
    await c.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
  }
}

// ─── Seed ────────────────────────────────────────────────────────────────────

export async function seed(c: PoolClient, orgId: string): Promise<void> {
  // 1. Users. Two distinct rows so separation of duties is exercisable for BOTH
  //    gates that depend on it: closure (#616 — the remediator cannot self-close)
  //    and risk acceptance (#646 — the proposer cannot approve their own request).
  //    Both carry a real argon2 password; see WALKTHROUGH_PASSWORD above for why.
  const passwordHash = await argon2.hash(WALKTHROUGH_PASSWORD);

  const analystId = await ensureWalkthroughUser(
    c,
    orgId,
    ANALYST_EMAIL,
    "[SEED] Walkthrough Analyst",
    PROPOSER_ROLE,
    passwordHash
  );
  const approverId = await ensureWalkthroughUser(
    c,
    orgId,
    APPROVER_EMAIL,
    "[SEED] Walkthrough Approver",
    APPROVER_ROLE,
    passwordHash
  );

  // An ACTIVE api_keys row is mandatory for SESSION auth, which reads as a
  // contradiction until you look at requireApiKey.ts:113-124: the JWT bridge looks up
  // "the org's active API key" on every request and 401s `no_active_api_key` when the
  // org has none. So without this row the walkthrough users authenticate at
  // /auth/login and are then rejected by every API call — passwords alone are not
  // enough. key_hash is a deliberate non-secret placeholder: this row is never used to
  // authenticate a key-based request, only to satisfy that lookup. Same pattern, and
  // the same reasoning, as scripts/seed-demo.ts:113-118.
  await ensureRow(
    c,
    `SELECT id FROM api_keys WHERE organization_id = $1 AND label = '[SEED] Walkthrough Key'`,
    [orgId],
    `INSERT INTO api_keys
       (organization_id, label, key_hash, entitlement_level, status, created_by_user_id)
     VALUES ($1, '[SEED] Walkthrough Key', $2, 'platform', 'active', $3) RETURNING id`,
    [orgId, `seed-walkthrough-not-for-auth-${orgId}`, approverId]
  );

  // 2. Org policy. Evidence gate ON and SoD ON — the walkthrough should exercise
  //    both, not bypass them. cadence_by_rating is NOT NULL with no DB default.
  await c.query(
    `INSERT INTO risk_settings
       (organization_id, cadence_by_rating, require_evidence_gate,
        require_finding_closure_sod, finding_sla_by_severity, approval_threshold_score)
     VALUES ($1, $2::jsonb, TRUE, TRUE, $3::jsonb, 70)
     ON CONFLICT (organization_id) DO UPDATE SET
       cadence_by_rating           = EXCLUDED.cadence_by_rating,
       require_evidence_gate       = EXCLUDED.require_evidence_gate,
       require_finding_closure_sod = EXCLUDED.require_finding_closure_sod,
       finding_sla_by_severity     = EXCLUDED.finding_sla_by_severity,
       approval_threshold_score    = EXCLUDED.approval_threshold_score,
       updated_at                  = NOW()`,
    [
      orgId,
      JSON.stringify({ Critical: 30, High: 60, Moderate: 90, Low: 180 }),
      JSON.stringify({ Critical: 7, High: 14, Moderate: 30, Low: 90 }),
    ]
  );

  // 3. Vendors (2). Names UNPREFIXED — see the naming note in the header.
  const msftId = await upsertId(
    c,
    `INSERT INTO vendors (organization_id, name, category, criticality, data_sensitivity,
                          access_level, service_description, status, owner_user_id, current_risk_score)
     VALUES ($1, 'Microsoft', 'Productivity & Identity', 'critical', 'restricted', 'admin',
             '[SEED] Microsoft 365, Exchange, SharePoint, Defender, Entra ID', 'active', $2, 72)
     ON CONFLICT (organization_id, name) DO NOTHING RETURNING id`,
    [orgId, analystId],
    `SELECT id FROM vendors WHERE organization_id = $1 AND name = 'Microsoft'`,
    [orgId]
  );
  const ciscoId = await upsertId(
    c,
    `INSERT INTO vendors (organization_id, name, category, criticality, data_sensitivity,
                          access_level, service_description, status, owner_user_id, current_risk_score)
     VALUES ($1, 'Cisco', 'Networking', 'high', 'confidential', 'network_access',
             '[SEED] Catalyst SD-WAN edge and branch networking', 'active', $2, 58)
     ON CONFLICT (organization_id, name) DO NOTHING RETURNING id`,
    [orgId, analystId],
    `SELECT id FROM vendors WHERE organization_id = $1 AND name = 'Cisco'`,
    [orgId]
  );

  // 4. Completed vendor assessments — the source record a vendor_review finding
  //    walks to resolve its affected vendor. NO unique key: SELECT-then-INSERT.
  const msftAssessmentId = await ensureRow(
    c,
    `SELECT id FROM vendor_assessments
      WHERE organization_id = $1 AND vendor_id = $2 AND assessment_type = '[SEED] Annual Security Review'`,
    [orgId, msftId],
    `INSERT INTO vendor_assessments
       (organization_id, vendor_id, assessment_type, overall_severity, status, summary, performed_at, reviewer_id)
     VALUES ($1, $2, '[SEED] Annual Security Review', 'High', 'completed',
             '[SEED] Microsoft assessed. Subprocessor disclosure incomplete; SOC 2 CUEC coverage partial.',
             CURRENT_DATE - 30, $3)
     RETURNING id`,
    [orgId, msftId, analystId]
  );
  await ensureRow(
    c,
    `SELECT id FROM vendor_assessments
      WHERE organization_id = $1 AND vendor_id = $2 AND assessment_type = '[SEED] Annual Security Review'`,
    [orgId, ciscoId],
    `INSERT INTO vendor_assessments
       (organization_id, vendor_id, assessment_type, overall_severity, status, summary, performed_at, reviewer_id)
     VALUES ($1, $2, '[SEED] Annual Security Review', 'Moderate', 'completed',
             '[SEED] Cisco assessed. Patch cadence documented; edge device inventory incomplete.',
             CURRENT_DATE - 45, $3)
     RETURNING id`,
    [orgId, ciscoId, analystId]
  );

  // 5. Vendor→product dependency records. This is the closest thing the schema
  //    has to the requested "product attestation" — a real FK from a named
  //    product to its vendor. NOTE: `dependencies.criticality` is Title-Case
  //    (Critical/High/Moderate/Low) while every asset table is lowercase.
  const PRODUCTS: Array<[string, string, string, string, string]> = [
    // [vendorId, product name, dependency_type, criticality (Title-Case), version]
    [msftId, "SharePoint Online", "cloud_service", "Critical", "2024 Wave 2"],
    [msftId, "Exchange Server", "infrastructure", "Critical", "2019 CU14"],
    [msftId, "Microsoft Defender for Endpoint", "cloud_service", "High", "P2"],
    [ciscoId, "Cisco Catalyst SD-WAN", "infrastructure", "High", "20.12"],
  ];
  for (const [vendorId, name, depType, crit, version] of PRODUCTS) {
    await ensureRow(
      c,
      `SELECT id FROM dependencies WHERE organization_id = $1 AND name = $2`,
      [orgId, name],
      `INSERT INTO dependencies
         (organization_id, name, dependency_type, criticality, status, vendor_id, version, description)
       VALUES ($1, $2, $3, $4, 'active', $5, $6, '[SEED] Vendor-supplied product dependency')
       RETURNING id`,
      [orgId, name, depType, crit, vendorId, version]
    );
  }

  // 6. Global canonical products. Populated so the canonical-product identity is
  //    present and matchable; nothing in a live READ path consumes these yet.
  await ensureCanonicalProduct(c, "Microsoft", "SharePoint");
  await ensureCanonicalProduct(c, "Microsoft", "Exchange");
  await ensureCanonicalProduct(c, "Microsoft", "Defender");
  await ensureCanonicalProduct(c, "Cisco", "Catalyst SD-WAN");

  // 7. Assets (5). Names must canonicalize to the product key for
  //    tenantAssetResolver to match — hence "Exchange", not "EXCH-PROD-01".
  //    (That brittleness is itself a finding; see the report.)
  //    There are NO CIA columns anywhere in the schema — criticality is the only
  //    business-impact dimension an asset carries.
  const entity = async (name: string, type: string, crit: string, desc: string) =>
    upsertId(
      c,
      `INSERT INTO enterprise_entities
         (organization_id, entity_type, name, description, owner_user_id, status, criticality, confidence, provenance)
       VALUES ($1, $2, $3, $4, $5, 'active', $6, 'high', 'manual')
       ON CONFLICT (organization_id, entity_type, name) DO NOTHING RETURNING id`,
      [orgId, type, name, desc, analystId, crit],
      `SELECT id FROM enterprise_entities
        WHERE organization_id = $1 AND entity_type = $2 AND name = $3`,
      [orgId, type, name]
    );

  const sharepointId = await entity("SharePoint", "application", "critical", "[SEED] SaaS collaboration — customer contracts and PHI");
  const defenderId = await entity("Defender", "application", "medium", "[SEED] Endpoint detection and response agent");
  const sdwanId = await entity("Catalyst SD-WAN", "application", "high", "[SEED] Branch network edge fabric");

  const endpoint = async (name: string, host: string, os: string, exposure: string, crit: string) =>
    upsertId(
      c,
      `INSERT INTO endpoints
         (organization_id, name, criticality, owner_user_id, status, hostname, os, exposure, last_seen_at)
       VALUES ($1, $2, $3, $4, 'active', $5, $6, $7, NOW())
       ON CONFLICT (organization_id, name) DO NOTHING RETURNING id`,
      [orgId, name, crit, analystId, host, os, exposure],
      `SELECT id FROM endpoints WHERE organization_id = $1 AND name = $2`,
      [orgId, name]
    );

  const exchangeId = await endpoint("Exchange", "exch-prod-01", "Windows Server 2022", "internet_facing", "critical");
  const laptopFleetId = await endpoint("Corporate Laptop Fleet", "fleet-win11", "Windows 11", "internal", "medium");

  // 8. AI system + its vendor dependency. ai_system_vendor_dependencies is the
  //    ONLY dependency data any UI actually renders (vendor + AI system detail).
  const copilotId = await upsertId(
    c,
    `INSERT INTO ai_systems
       (organization_id, name, use_case, owner_user_id, model_type, data_classification,
        deployment_status, criticality, risk_classification)
     VALUES ($1, 'Customer Support Copilot',
             '[SEED] Answers customer tickets using documents indexed from SharePoint',
             $2, 'vendor-supplied', 'confidential', 'production', 'high', 'high')
     ON CONFLICT (organization_id, name) DO NOTHING RETURNING id`,
    [orgId, analystId],
    `SELECT id FROM ai_systems WHERE organization_id = $1 AND name = 'Customer Support Copilot'`,
    [orgId]
  );
  await c.query(
    `INSERT INTO ai_system_vendor_dependencies
       (organization_id, ai_system_id, vendor_id, dependency_role, notes)
     VALUES ($1, $2, $3, 'data_source', '[SEED] Indexes SharePoint content as its retrieval corpus')
     ON CONFLICT (organization_id, ai_system_id, vendor_id, dependency_role)
       WHERE deleted_at IS NULL DO NOTHING`,
    [orgId, copilotId, msftId]
  );

  // 9. Asset spine + asset→vendor edges. from_id is the ASSETS id, not the backing id.
  const msftAsset = await ensureAsset(c, orgId, "vendor", "vendors", msftId);
  const ciscoAsset = await ensureAsset(c, orgId, "vendor", "vendors", ciscoId);
  const copilotAsset = await ensureAsset(c, orgId, "ai_system", "ai_systems", copilotId);
  const sharepointAsset = await ensureAsset(c, orgId, "application", "enterprise_entities", sharepointId);
  const defenderAsset = await ensureAsset(c, orgId, "application", "enterprise_entities", defenderId);
  const sdwanAsset = await ensureAsset(c, orgId, "application", "enterprise_entities", sdwanId);
  const exchangeAsset = await ensureAsset(c, orgId, "endpoint", "endpoints", exchangeId);
  const laptopAsset = await ensureAsset(c, orgId, "endpoint", "endpoints", laptopFleetId);
  void msftAsset;
  void ciscoAsset;

  await ensureEdge(c, orgId, sharepointAsset, msftId, "depends_on", "[SEED] SaaS provided by Microsoft");
  await ensureEdge(c, orgId, exchangeAsset, msftId, "depends_on", "[SEED] Runs Microsoft Exchange Server");
  await ensureEdge(c, orgId, defenderAsset, msftId, "depends_on", "[SEED] Microsoft Defender for Endpoint");
  await ensureEdge(c, orgId, sdwanAsset, ciscoId, "depends_on", "[SEED] Cisco Catalyst SD-WAN fabric");
  await ensureEdge(c, orgId, laptopAsset, msftId, "managed_by", "[SEED] Managed via Microsoft Intune");
  await ensureEdge(c, orgId, copilotAsset, msftId, "depends_on", "[SEED] Retrieval corpus sourced from SharePoint");

  // 10. Framework → requirements → controls.
  const frameworkId = await upsertId(
    c,
    `INSERT INTO frameworks (organization_id, name, version) VALUES ($1, 'NIST CSF', '2.0')
     ON CONFLICT (organization_id, name, version) DO NOTHING RETURNING id`,
    [orgId],
    `SELECT id FROM frameworks WHERE organization_id = $1 AND name = 'NIST CSF' AND version = '2.0'`,
    [orgId]
  );

  const requirement = async (ref: string, title: string) =>
    upsertId(
      c,
      `INSERT INTO requirements (framework_id, reference_id, title, description)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (framework_id, reference_id) DO NOTHING RETURNING id`,
      [frameworkId, ref, title, `[SEED] ${title}`],
      `SELECT id FROM requirements WHERE framework_id = $1 AND reference_id = $2`,
      [frameworkId, ref]
    );

  const reqAA05 = await requirement("PR.AA-05", "Access permissions and authorizations are managed");
  const reqCM01 = await requirement("DE.CM-01", "Networks and network services are monitored");
  const reqMA01 = await requirement("RS.MA-01", "The incident response plan is executed");

  const control = async (name: string, desc: string, family: string, status: string) =>
    upsertId(
      c,
      `INSERT INTO controls
         (organization_id, name, description, owner_user_id, control_type, status, domain,
          control_family, maturity_level, implementation_status, testing_frequency, last_tested_at, next_test_due)
       VALUES ($1, $2, $3, $4, 'preventive', 'active', 'Security', $5, 'managed', $6,
               'quarterly', CURRENT_DATE - 20, CURRENT_DATE + 70)
       ON CONFLICT (organization_id, name) DO NOTHING RETURNING id`,
      [orgId, name, desc, analystId, family, status],
      `SELECT id FROM controls WHERE organization_id = $1 AND name = $2`,
      [orgId, name]
    );

  const ctlMfa = await control(
    "MFA enforcement on privileged accounts",
    "[SEED] All privileged accounts must authenticate with phishing-resistant MFA.",
    "Access Control",
    "partially_implemented"
  );
  const ctlEdr = await control(
    "Endpoint detection and response coverage",
    "[SEED] EDR agent deployed and reporting on all managed endpoints.",
    "Detection",
    "implemented"
  );
  const ctlIr = await control(
    "Security incident response plan",
    "[SEED] Documented, tested IR plan with defined escalation paths.",
    "Response",
    "implemented"
  );

  for (const [ctl, req] of [
    [ctlMfa, reqAA05],
    [ctlEdr, reqCM01],
    [ctlIr, reqMA01],
  ]) {
    await c.query(
      `INSERT INTO control_mappings (control_id, requirement_id) VALUES ($1, $2)
       ON CONFLICT (control_id, requirement_id) DO NOTHING`,
      [ctl, req]
    );
  }

  // 11. Obligations.
  const obligation = async (title: string, reg: string, juris: string, domain: string, prio: string) =>
    upsertId(
      c,
      `INSERT INTO obligations
         (organization_id, title, description, source_regulation, jurisdiction, domain,
          status, priority, due_date, owner_user_id)
       VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, CURRENT_DATE + 60, $8)
       ON CONFLICT (organization_id, title) DO NOTHING RETURNING id`,
      [orgId, title, `[SEED] ${title}`, reg, juris, domain, prio, analystId],
      `SELECT id FROM obligations WHERE organization_id = $1 AND title = $2`,
      [orgId, title]
    );

  const oblHipaa = await obligation(
    "HIPAA Security Rule — Access Control (164.312(a)(1))",
    "HIPAA", "US", "Privacy", "near_term"
  );
  const oblSec = await obligation(
    "SEC Cybersecurity Disclosure — Material Incident (Form 8-K Item 1.05)",
    "SEC", "US", "Regulatory", "immediate"
  );
  const oblAiAct = await obligation(
    "EU AI Act — High-Risk System Obligations",
    "EU AI Act", "EU", "AI Governance", "planned"
  );
  void oblAiAct;

  // 12. Control assessment — ONE record, TWO findings hang off it. That shared
  //     source_id is what gives Related Findings a true positive on the
  //     assessment path. No unique key: SELECT-then-INSERT.
  const mfaAssessmentId = await ensureRow(
    c,
    `SELECT id FROM control_assessments
      WHERE organization_id = $1 AND control_id = $2 AND summary LIKE '[SEED]%'`,
    [orgId, ctlMfa],
    `INSERT INTO control_assessments
       (organization_id, control_id, status, overall_severity, summary, performed_at, reviewer_id)
     VALUES ($1, $2, 'failed', 'High',
             '[SEED] Q3 access control test. MFA not enforced on 3 privileged accounts; admin console session logging absent.',
             CURRENT_DATE - 10, $3)
     RETURNING id`,
    [orgId, ctlMfa, analystId]
  );

  // 13. Intelligence. cyber_signals are ORG-SCOPED here (the column is nullable
  //     and global is how the real pipeline runs) so teardown can never touch
  //     rows another staging org shares. intelligence_events are unavoidably
  //     GLOBAL — hence the synthetic canonical keys, deleted by key on teardown.
  const signal = async (
    sigType: string,
    severity: string,
    summary: string,
    vendorName: string,
    cve: string,
    dedup: string
  ) =>
    upsertId(
      c,
      `INSERT INTO cyber_signals
         (organization_id, source, signal_type, severity, raw_payload, normalized_summary,
          affected_vendor, affected_cve, dedup_hash, processed, published_at)
       VALUES ($1, 'seed_walkthrough', $2, $3, '{"seed":true}'::jsonb, $4, $5, $6, $7, TRUE, NOW() - INTERVAL '2 days')
       ON CONFLICT (organization_id, dedup_hash) DO NOTHING RETURNING id`,
      [orgId, sigType, severity, summary, vendorName, cve, dedup],
      `SELECT id FROM cyber_signals WHERE organization_id = $1 AND dedup_hash = $2`,
      [orgId, dedup]
    );

  const sigSharePoint = await signal(
    "cve", "Critical",
    `[SEED] ${CVE_SHAREPOINT}: unauthenticated remote code execution in SharePoint. Active exploitation reported against internet-facing instances.`,
    "Microsoft", CVE_SHAREPOINT, "seed-walkthrough-sharepoint-rce"
  );
  const sigExchange = await signal(
    "cve", "High",
    `[SEED] ${CVE_EXCHANGE}: privilege escalation in Exchange Server. Patch available; no exploitation observed.`,
    "Microsoft", CVE_EXCHANGE, "seed-walkthrough-exchange-privesc"
  );
  const sigSdwan = await signal(
    "cve", "High",
    `[SEED] ${CVE_SDWAN}: authentication bypass in Cisco Catalyst SD-WAN management plane.`,
    "Cisco", CVE_SDWAN, "seed-walkthrough-sdwan-authbypass"
  );

  // affected_vendor must EXACTLY equal vendors.name — the event-native vendor
  // resolution is a lower(trim()) string equality, not an FK.
  const event = async (
    key: string, title: string, summary: string, severity: string, status: string,
    vendorName: string, cve: string, exploited: boolean, patched: boolean, confidence: number
  ) =>
    upsertId(
      c,
      `INSERT INTO intelligence_events
         (canonical_key, title, executive_summary, summary_status, event_type, severity, status,
          ever_exploited, ever_patched, affected_cve, affected_vendor, source_count, confidence,
          first_seen_at, last_seen_at)
       VALUES ($1, $2, $3, 'complete', 'vulnerability', $4, $5, $6, $7, $8, $9, 1, $10,
               NOW() - INTERVAL '3 days', NOW() - INTERVAL '2 days')
       ON CONFLICT (canonical_key) DO NOTHING RETURNING id`,
      [key, title, summary, severity, status, exploited, patched, cve, vendorName, confidence],
      `SELECT id FROM intelligence_events WHERE canonical_key = $1`,
      [key]
    );

  const evtSharePoint = await event(
    `cve:${CVE_SHAREPOINT}`,
    `[SEED] SharePoint unauthenticated RCE (${CVE_SHAREPOINT}) — actively exploited`,
    "[SEED] Unauthenticated RCE in on-premises and hybrid SharePoint. Exploitation observed in the wild against internet-facing servers. Out-of-band patch published.",
    "Critical", "actively_exploited", "Microsoft", CVE_SHAREPOINT, true, true, 92
  );
  const evtExchange = await event(
    `cve:${CVE_EXCHANGE}`,
    `[SEED] Exchange Server privilege escalation (${CVE_EXCHANGE})`,
    "[SEED] Local privilege escalation in Exchange Server. Patch available. No exploitation observed to date.",
    "High", "confirmed", "Microsoft", CVE_EXCHANGE, false, true, 78
  );
  const evtSdwan = await event(
    `cve:${CVE_SDWAN}`,
    `[SEED] Cisco Catalyst SD-WAN authentication bypass (${CVE_SDWAN})`,
    "[SEED] Authentication bypass in the SD-WAN management plane permits unauthenticated configuration change.",
    "High", "confirmed", "Cisco", CVE_SDWAN, false, true, 81
  );

  // The bridge. WITHOUT these rows an event-sourced finding resolves NO signals,
  // so its links, candidates and affected buckets all go dark — and the brief's
  // ?intel_ref= click-through cannot find the finding at all.
  for (const [evt, sig] of [
    [evtSharePoint, sigSharePoint],
    [evtExchange, sigExchange],
    [evtSdwan, sigSdwan],
  ]) {
    await c.query(
      `INSERT INTO intelligence_event_sources
         (event_id, cyber_signal_id, source, relation, confidence)
       VALUES ($1, $2, 'seed_walkthrough', 'canonical', 90)
       ON CONFLICT (event_id, cyber_signal_id) DO NOTHING`,
      [evt, sig]
    );
  }

  await c.query(
    `INSERT INTO intelligence_event_timeline (event_id, entry_type, occurred_at, summary, source)
     SELECT $1, v.entry_type, v.occurred_at, v.summary, 'seed_walkthrough'
       FROM (VALUES
         ('first_seen'::text,       NOW() - INTERVAL '3 days', '[SEED] Advisory published by vendor.'::text),
         ('exploit_activity'::text, NOW() - INTERVAL '2 days', '[SEED] Active exploitation observed against internet-facing servers.'::text),
         ('patch_available'::text,  NOW() - INTERVAL '2 days', '[SEED] Out-of-band patch released.'::text)
       ) AS v(entry_type, occurred_at, summary)
      WHERE NOT EXISTS (
        SELECT 1 FROM intelligence_event_timeline t WHERE t.event_id = $1
      )`,
    [evtSharePoint]
  );

  // 14. Signal → entity links. These populate the four "Affected" buckets for the
  //     cyber_signal-sourced findings. deleted_at IS NULL is required to be seen.
  await c.query(
    `INSERT INTO signal_vendor_links (organization_id, signal_id, vendor_id, note, created_by_user_id)
     VALUES ($1, $2, $3, '[SEED] SharePoint is a Microsoft product', $4)
     ON CONFLICT (organization_id, signal_id, vendor_id) WHERE deleted_at IS NULL DO NOTHING`,
    [orgId, sigSharePoint, msftId, analystId]
  );
  await c.query(
    `INSERT INTO signal_ai_system_links (organization_id, signal_id, ai_system_id, note, created_by_user_id)
     VALUES ($1, $2, $3, '[SEED] Copilot indexes SharePoint content as its retrieval corpus', $4)
     ON CONFLICT (organization_id, signal_id, ai_system_id) WHERE deleted_at IS NULL DO NOTHING`,
    [orgId, sigSharePoint, copilotId, analystId]
  );
  await c.query(
    `INSERT INTO signal_control_links (organization_id, signal_id, control_id, note, created_by_user_id)
     VALUES ($1, $2, $3, '[SEED] EDR is the compensating control pending patch', $4)
     ON CONFLICT (organization_id, signal_id, control_id) WHERE deleted_at IS NULL DO NOTHING`,
    [orgId, sigSharePoint, ctlEdr, analystId]
  );
  await c.query(
    `INSERT INTO signal_obligation_links (organization_id, signal_id, obligation_id, note, created_by_user_id)
     VALUES ($1, $2, $3, '[SEED] Exploitation of a customer-data system may trigger 8-K materiality assessment', $4)
     ON CONFLICT (organization_id, signal_id, obligation_id) WHERE deleted_at IS NULL DO NOTHING`,
    [orgId, sigSharePoint, oblSec, analystId]
  );
  await c.query(
    `INSERT INTO signal_vendor_links (organization_id, signal_id, vendor_id, note, created_by_user_id)
     VALUES ($1, $2, $3, '[SEED] Catalyst SD-WAN is a Cisco product', $4)
     ON CONFLICT (organization_id, signal_id, vendor_id) WHERE deleted_at IS NULL DO NOTHING`,
    [orgId, sigSdwan, ciscoId, analystId]
  );

  // 15. Pending suggested links. The resolver DROPS any candidate whose target is
  //     already an affected entity, so these MUST target entities not linked above.
  //     match_score is INTEGER 0-100 (not a 0-1 fraction), and signal_id is NOT NULL
  //     even for the event-native path.
  for (const [targetType, targetId, reason, score] of [
    ["control", ctlMfa, "[SEED] MFA on privileged accounts limits post-exploitation lateral movement", 74],
    ["obligation", oblHipaa, "[SEED] SharePoint stores PHI; access-control obligation is in scope", 66],
  ] as Array<[string, string, string, number]>) {
    await c.query(
      `INSERT INTO signal_match_suggestions
         (organization_id, signal_id, intelligence_event_id, target_type, target_id, match_reason, match_score)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (organization_id, signal_id, target_type, target_id)
         WHERE accepted_at IS NULL AND dismissed_at IS NULL
         DO NOTHING`,
      [orgId, sigSharePoint, evtSharePoint, targetType, targetId, reason, score]
    );
  }

  // 16. Findings (8). operational_status is NOT set here — it is DERIVED in
  //     step 19 from the actions + evidence gate, exactly as production does.
  const finding = async (
    title: string, severity: string, description: string, recommendation: string,
    sourceType: string, sourceId: string | null, domain: string, priority: string,
    likelihood: string, confidence: string, decisionState: string, status: string,
    dueOffsetDays: number
  ) =>
    ensureRow(
      c,
      `SELECT id FROM findings WHERE organization_id = $1 AND title = $2`,
      [orgId, title],
      `INSERT INTO findings
         (organization_id, title, severity, description, recommendation, source_type, source_id,
          domain, priority, likelihood, confidence, time_sensitivity, owner_user_id, due_date,
          decision_state, status, assessment_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $9, $12,
               CURRENT_DATE + ($13)::int, $14, $15, NULL)
       RETURNING id`,
      [
        orgId, title, severity, description, recommendation, sourceType, sourceId,
        domain, priority, likelihood, confidence, analystId, dueOffsetDays,
        decisionState, status,
      ]
    );

  // F1 + F2 — SAME source_id. This is the Related Findings true positive.
  const f1 = await finding(
    "[SEED] SharePoint RCE actively exploited — internet-facing instance unpatched",
    "Critical",
    `[SEED] ${CVE_SHAREPOINT} permits unauthenticated remote code execution. exch-prod-01 and the SharePoint tenant are reachable from the internet. Exploitation is confirmed in the wild.`,
    "[SEED] Apply the Microsoft out-of-band patch to the SharePoint farm within 72 hours. Until patched, restrict inbound access at the SD-WAN edge and confirm Defender EDR is reporting on all SharePoint hosts.",
    "cyber_signal", sigSharePoint, "Vendor Risk", "immediate", "very_high", "high", "mitigating", "in_progress", 3
  );
  const f2 = await finding(
    "[SEED] SharePoint content database reachable without authentication",
    "High",
    `[SEED] The content database backing the SharePoint tenant accepts unauthenticated reads from the corporate network, widening the blast radius of ${CVE_SHAREPOINT}.`,
    "[SEED] Restrict the content database to the application tier only and require authenticated service-account access.",
    "cyber_signal", sigSharePoint, "Vendor Risk", "near_term", "high", "high", "mitigating", "in_progress", 10
  );

  // F3 — intelligence_event source. A partial unique index on
  // (organization_id, source_id) WHERE source_type='intelligence_event' makes a
  // SECOND event-sourced finding impossible, so Related Findings here is
  // structurally guaranteed to be 0. That zero is a code defect, not a data gap.
  const f3 = await finding(
    "[SEED] Exchange Server privilege escalation — patch not applied",
    "High",
    `[SEED] ${CVE_EXCHANGE} permits local privilege escalation on exch-prod-01. A patch is available and has not been applied.`,
    "[SEED] Schedule the Exchange cumulative update in the next maintenance window.",
    "intelligence_event", evtExchange, "Vendor Risk", "near_term", "medium", "high", "needs_review", "open", 14
  );

  // F4 + F5 — SAME control_assessment source_id. Related Findings on the
  // assessment path. F4 deliberately gets NO evidence: its action closes, and the
  // evidence gate must hold it at in_progress rather than letting it reach remediated.
  const f4 = await finding(
    "[SEED] MFA not enforced on 3 privileged accounts",
    "High",
    "[SEED] Q3 access control testing found three privileged accounts authenticating with password only. Phishing-resistant MFA is required by policy.",
    "[SEED] Enrol the three accounts in phishing-resistant MFA and enable conditional access enforcement tenant-wide.",
    "control_test", mfaAssessmentId, "Access Control", "immediate", "high", "high", "mitigating", "in_progress", 7
  );
  const f5 = await finding(
    "[SEED] Privileged session logging absent on admin console",
    "Moderate",
    "[SEED] Administrative console sessions are not logged, so privileged activity cannot be reconstructed during an incident.",
    "[SEED] Enable session logging and forward to the SIEM with a 400-day retention.",
    "control_test", mfaAssessmentId, "Access Control", "near_term", "medium", "medium", "needs_review", "open", 30
  );

  // F6 — vendor_review source; the vendor resolves by walking the assessment record.
  const f6 = await finding(
    "[SEED] Microsoft assessment — subprocessor disclosure incomplete",
    "Moderate",
    "[SEED] The annual Microsoft assessment could not confirm the full subprocessor list for the SharePoint and Exchange services, leaving nth-party exposure unquantified.",
    "[SEED] Request the current subprocessor register and reconcile against the dependency inventory.",
    "vendor_review", msftAssessmentId, "Vendor Risk", "planned", "medium", "medium", "needs_review", "open", 45
  );

  // F7 — the second vendor, so the walkthrough is not single-vendor.
  const f7 = await finding(
    "[SEED] Catalyst SD-WAN authentication bypass — edge devices unpatched",
    "High",
    `[SEED] ${CVE_SDWAN} permits unauthenticated configuration change on the SD-WAN management plane. The edge device inventory is incomplete, so exposure cannot be fully bounded.`,
    "[SEED] Complete the edge device inventory, then patch all Catalyst SD-WAN devices to 20.12.4 or later.",
    "cyber_signal", sigSdwan, "Vendor Risk", "near_term", "medium", "medium", "mitigating", "in_progress", 14
  );

  // F8 — manual, source_id NULL. Every affected bucket is honestly
  // "not applicable"; intelligence, candidates and related are all empty. This is
  // the FLOOR state — what a finding with no canonical source can ever show.
  const f8 = await finding(
    "[SEED] AI copilot retains customer PII beyond the stated retention window",
    "Moderate",
    "[SEED] Manual review found the Customer Support Copilot retains ticket transcripts containing customer PII for 24 months; the published retention commitment is 90 days.",
    "[SEED] Implement a 90-day purge job on the transcript store and update the AI system record.",
    "manual", null, "AI Governance", "near_term", "medium", "medium", "needs_review", "open", 21
  );

  // 17. Evidence. source_type='finding' (singular) is the attach point.
  //     F4 is deliberately left WITHOUT evidence — see step 19.
  for (const [findingId, title, evType, desc] of [
    [f1, "[SEED] Patch deployment log — SharePoint farm", "log", "[SEED] Deployment log showing the out-of-band patch applied to 2 of 3 SharePoint hosts."],
    [f2, "[SEED] Network ACL change ticket CHG-10442", "document", "[SEED] Approved change restricting the content database to the application tier."],
  ] as Array<[string, string, string, string]>) {
    await ensureRow(
      c,
      `SELECT id FROM evidence WHERE organization_id = $1 AND source_type = 'finding'
         AND source_id = $2 AND title = $3`,
      [orgId, findingId, title],
      `INSERT INTO evidence
         (organization_id, source_type, source_id, title, description, evidence_type, collected_at, collected_by)
       VALUES ($1, 'finding', $2, $3, $4, $5, CURRENT_DATE - 1, '[SEED] Walkthrough Analyst')
       RETURNING id`,
      [orgId, findingId, title, desc, evType]
    );
  }

  // 18. Actions — four, in four different states. These DRIVE operational_status.
  //     priority is NOT NULL with no default.
  for (const [findingId, title, desc, priority, status] of [
    [f1, "[SEED] Apply Microsoft out-of-band patch to SharePoint farm", "[SEED] Patch all SharePoint hosts; 1 of 3 remaining.", "immediate", "in_progress"],
    [f2, "[SEED] Restrict SharePoint content database network exposure", "[SEED] ACL applied and verified.", "near_term", "closed"],
    [f4, "[SEED] Enrol 3 privileged accounts in phishing-resistant MFA", "[SEED] Enrolment complete; awaiting evidence upload.", "immediate", "closed"],
    [f7, "[SEED] Inventory and patch Catalyst SD-WAN edge devices", "[SEED] Blocked: device inventory incomplete, branch sites unreachable.", "near_term", "blocked"],
  ] as Array<[string, string, string, string, string]>) {
    await ensureRow(
      c,
      `SELECT id FROM actions WHERE organization_id = $1 AND source_type = 'finding'
         AND source_id = $2 AND title = $3`,
      [orgId, findingId, title],
      `INSERT INTO actions
         (organization_id, title, description, action_type, source_type, source_id,
          priority, due_date, owner_user_id, status, completed_at)
       VALUES ($1, $3, $4, 'seed_walkthrough', 'finding', $2, $5, CURRENT_DATE + 7, $6, $7,
               CASE WHEN $7 IN ('closed','accepted') THEN NOW() - INTERVAL '1 day' ELSE NULL END)
       RETURNING id`,
      [orgId, findingId, title, desc, priority, analystId, status]
    );
  }

  // 18b. Risks — walkthrough item 3. Findings do NOT auto-create risks (the
  //      only INSERT INTO risks in src/ is user-initiated POST /api/risks), so
  //      the register is seeded the way production populates it: risks PROMOTED
  //      from findings, carrying source_type='finding'. Three risks light up the
  //      Open Risks ladder, the residual heatmap and /risks, and their ratings
  //      reconcile with the severities of the findings they came from. A fresh
  //      org (zero risks) remains the honest-empty state the dashboard's
  //      explanatory empty state renders — that path is regression-tested.
  for (const [srcFinding, title, domain, inhL, inhI, inhR, resL, resI, resR, dueOffset] of [
    [
      f4, "[SEED] Privileged account compromise via password-only authentication",
      "Access Control", "very_likely", "Critical", "Critical", "likely", "High", "High", 30,
    ],
    [
      f6, "[SEED] Unquantified nth-party exposure across Microsoft-hosted services",
      "Vendor Risk", "likely", "High", "High", "possible", "Moderate", "Moderate", 60,
    ],
    [
      f8, "[SEED] Customer PII retained beyond stated commitments in AI copilot",
      "AI Governance", "likely", "High", "High", "likely", "High", "High", 45,
    ],
  ] as Array<[string, string, string, string, string, string, string, string, string, number]>) {
    await ensureRow(
      c,
      `SELECT id FROM risks WHERE organization_id = $1 AND title = $2`,
      [orgId, title],
      `INSERT INTO risks
         (organization_id, title, domain, status, owner, due_date,
          likelihood, impact, risk_rating,
          inherent_likelihood, inherent_impact, inherent_rating,
          residual_likelihood, residual_impact, residual_rating,
          source_type, source_id)
       VALUES ($1, $2, $3, 'open', '[SEED] Walkthrough Analyst', CURRENT_DATE + ($4)::int,
               $5, $6, $7, $8, $9, $10, $11, $12, $13, 'finding', $14)
       RETURNING id`,
      [orgId, title, domain, dueOffset, resL, resI, resR, inhL, inhI, inhR, resL, resI, resR, srcFinding]
    );
  }

  // 19. Derive operational_status EXACTLY as production does.
  //
  //     Mirrors deriveOperationalStatus() in findingLifecycleMachine.ts:57 and the
  //     gate query in findingLifecycle.ts:97 — including the fact that the gate's
  //     EXISTS check does NOT filter detached_at. We do not hand-set the column,
  //     because the next recompute at runtime would silently overwrite a value we
  //     invented and the seeded state would stop being self-consistent.
  //
  //     Expected outcome with require_evidence_gate = TRUE:
  //       F1 in_progress (1 action in_progress)
  //       F2 remediated  (action closed + evidence present  → gate satisfied)
  //       F4 in_progress (action closed but NO evidence     → gate HOLDS it back)
  //       F7 in_progress (1 action blocked)
  //       F3/F5/F6/F8 open (no actions)
  await c.query(
    `UPDATE findings f
        SET operational_status = d.derived, updated_at = NOW()
       FROM (
         SELECT
           f2.id,
           CASE
             WHEN EXISTS (SELECT 1 FROM actions a
                           WHERE a.organization_id = f2.organization_id
                             AND a.source_type = 'finding' AND a.source_id = f2.id
                             AND a.status IN ('in_progress','blocked'))
               THEN 'in_progress'
             WHEN EXISTS (SELECT 1 FROM actions a
                           WHERE a.organization_id = f2.organization_id
                             AND a.source_type = 'finding' AND a.source_id = f2.id)
              AND NOT EXISTS (SELECT 1 FROM actions a
                               WHERE a.organization_id = f2.organization_id
                                 AND a.source_type = 'finding' AND a.source_id = f2.id
                                 AND a.status NOT IN ('closed','accepted'))
               THEN CASE
                      WHEN COALESCE((SELECT s.require_evidence_gate FROM risk_settings s
                                      WHERE s.organization_id = f2.organization_id), FALSE)
                       AND NOT EXISTS (SELECT 1 FROM evidence e
                                        WHERE e.organization_id = f2.organization_id
                                          AND e.source_type = 'finding' AND e.source_id = f2.id)
                        THEN 'in_progress'
                      ELSE 'remediated'
                    END
             ELSE 'open'
           END AS derived
           FROM findings f2
          WHERE f2.organization_id = $1
       ) d
      WHERE f.id = d.id AND f.operational_status IS DISTINCT FROM d.derived`,
    [orgId]
  );

  // 20. Activity + "what's changed since your last review".
  //     Zone B needs a finding_review_marks row whose last_reviewed_at sits
  //     BETWEEN two security_audit_log rows — otherwise it renders
  //     "First review — no prior baseline" and looks broken.
  const auditRows: Array<[string, string, string]> = [
    [f1, "finding.created", JSON.stringify({ severity: "High" })],
    [f1, "finding.updated", JSON.stringify({ severity: "Critical", priority: "immediate" })],
  ];
  for (let i = 0; i < auditRows.length; i++) {
    const [findingId, eventType, payload] = auditRows[i];
    // created 5 days ago, updated 1 day ago
    const daysAgo = i === 0 ? 5 : 1;
    await c.query(
      `INSERT INTO security_audit_log
         (organization_id, event_type, resource_type, resource_id, payload, created_at)
       SELECT $1, $2, 'finding', $3, $4::jsonb, NOW() - ($5 || ' days')::interval
        WHERE NOT EXISTS (
          SELECT 1 FROM security_audit_log
           WHERE organization_id = $1 AND resource_type = 'finding'
             AND resource_id = $3 AND event_type = $2
        )`,
      [orgId, eventType, findingId, payload, String(daysAgo)]
    );
  }
  // Reviewed 3 days ago: AFTER finding.created, BEFORE finding.updated.
  await c.query(
    `INSERT INTO finding_review_marks (organization_id, finding_id, user_id, last_reviewed_at)
     VALUES ($1, $2, $3, NOW() - INTERVAL '3 days')
     ON CONFLICT (organization_id, finding_id, user_id)
       DO UPDATE SET last_reviewed_at = EXCLUDED.last_reviewed_at`,
    [orgId, f1, analystId]
  );

  void f3; void f5; void f6; void f8; void approverId; void laptopFleetId;
}

// ─── Summary ─────────────────────────────────────────────────────────────────

async function printSummary(c: PoolClient, orgId: string): Promise<void> {
  // Walkthrough credentials. The PLAINTEXT test password is printed because the whole
  // point of this org is that an operator can sign in as both parties; the hash is
  // never selected and never printed. These are staging-only credentials for a [SEED]
  // org on a non-prod database, guarded by the prod check in main().
  const users = await c.query<{ email: string; name: string; role: string; has_password: boolean }>(
    `SELECT email, name, role, (password_hash IS NOT NULL) AS has_password
       FROM users
      WHERE organization_id = $1 AND email = ANY($2)
      ORDER BY email`,
    [orgId, [ANALYST_EMAIL, APPROVER_EMAIL]]
  );

  if (users.rowCount) {
    console.log("\n  Walkthrough users — accepted-risk lifecycle");
    console.log("  " + "─".repeat(96));
    console.log(
      "  " + "email".padEnd(46) + "role".padEnd(10) + "acts as".padEnd(12) + "password"
    );
    for (const u of users.rows) {
      const actsAs = u.email === ANALYST_EMAIL ? "proposer" : "approver";
      console.log(
        "  " +
          String(u.email).padEnd(46) +
          String(u.role).padEnd(10) +
          actsAs.padEnd(12) +
          (u.has_password ? WALKTHROUGH_PASSWORD : "(NO PASSWORD — re-run the seed)")
      );
    }
    console.log(`
    Separation of duties: the proposer CANNOT approve their own request. The API
    enforces approver !== requested_by (403 separation_of_duties), backed by a DB
    CHECK. Propose as the proposer, then approve as the approver — two logins.

      propose  POST /api/findings/:id/risk-acceptance   (owner_user_id, rationale, expires_at)
      approve  POST /api/risk-acceptances/:id/approve
      reject   POST /api/risk-acceptances/:id/reject
      withdraw POST /api/risk-acceptances/:id/withdraw   → REOPENS the finding

    Session identity is REQUIRED — an API key returns 403 user_identity_required.
    Override the password with WALKTHROUGH_SEED_PASSWORD=... when re-seeding.`);
  }

  const counts = await c.query(
    `SELECT 'vendors' AS t, COUNT(*)::int AS n FROM vendors WHERE organization_id = $1
     UNION ALL SELECT 'vendor_assessments', COUNT(*)::int FROM vendor_assessments WHERE organization_id = $1
     UNION ALL SELECT 'dependencies (vendor products)', COUNT(*)::int FROM dependencies WHERE organization_id = $1
     UNION ALL SELECT 'assets (spine)', COUNT(*)::int FROM assets WHERE organization_id = $1
     UNION ALL SELECT 'enterprise_relationships', COUNT(*)::int FROM enterprise_relationships WHERE organization_id = $1 AND deleted_at IS NULL
     UNION ALL SELECT 'ai_systems', COUNT(*)::int FROM ai_systems WHERE organization_id = $1
     UNION ALL SELECT 'ai_system_vendor_dependencies', COUNT(*)::int FROM ai_system_vendor_dependencies WHERE organization_id = $1 AND deleted_at IS NULL
     UNION ALL SELECT 'controls', COUNT(*)::int FROM controls WHERE organization_id = $1
     UNION ALL SELECT 'control_assessments', COUNT(*)::int FROM control_assessments WHERE organization_id = $1
     UNION ALL SELECT 'obligations', COUNT(*)::int FROM obligations WHERE organization_id = $1
     UNION ALL SELECT 'cyber_signals', COUNT(*)::int FROM cyber_signals WHERE organization_id = $1
     UNION ALL SELECT 'signal links (all 4 kinds)', (
        (SELECT COUNT(*) FROM signal_vendor_links WHERE organization_id = $1 AND deleted_at IS NULL) +
        (SELECT COUNT(*) FROM signal_ai_system_links WHERE organization_id = $1 AND deleted_at IS NULL) +
        (SELECT COUNT(*) FROM signal_control_links WHERE organization_id = $1 AND deleted_at IS NULL) +
        (SELECT COUNT(*) FROM signal_obligation_links WHERE organization_id = $1 AND deleted_at IS NULL))::int
     UNION ALL SELECT 'signal_match_suggestions (pending)', COUNT(*)::int FROM signal_match_suggestions
        WHERE organization_id = $1 AND accepted_at IS NULL AND dismissed_at IS NULL
     UNION ALL SELECT 'findings', COUNT(*)::int FROM findings WHERE organization_id = $1
     UNION ALL SELECT 'actions', COUNT(*)::int FROM actions WHERE organization_id = $1
     UNION ALL SELECT 'evidence', COUNT(*)::int FROM evidence WHERE organization_id = $1`,
    [orgId]
  );

  console.log("\n  Inventory");
  console.log("  " + "─".repeat(58));
  for (const r of counts.rows) {
    console.log(`  ${String(r.t).padEnd(38)} ${String(r.n).padStart(3)}`);
  }

  const events = await c.query(
    `SELECT COUNT(*)::int AS n FROM intelligence_events WHERE canonical_key = ANY($1)`,
    [[`cve:${CVE_SHAREPOINT}`, `cve:${CVE_EXCHANGE}`, `cve:${CVE_SDWAN}`]]
  );
  console.log(`  ${"intelligence_events (global)".padEnd(38)} ${String(events.rows[0].n).padStart(3)}`);

  const findings = await c.query(
    `SELECT f.title, f.severity, f.source_type, f.decision_state, f.operational_status,
            (SELECT COUNT(*) FROM actions a
              WHERE a.organization_id = f.organization_id
                AND a.source_type = 'finding' AND a.source_id = f.id)::int AS actions,
            (SELECT COUNT(*) FROM evidence e
              WHERE e.organization_id = f.organization_id
                AND e.source_type = 'finding' AND e.source_id = f.id)::int AS evidence,
            (SELECT COUNT(*) FROM findings r
              WHERE r.organization_id = f.organization_id AND r.id <> f.id
                AND r.source_id = f.source_id AND r.source_type = f.source_type)::int AS related
       FROM findings f
      WHERE f.organization_id = $1
      ORDER BY f.created_at, f.title`,
    [orgId]
  );

  console.log("\n  Findings — what each one proves");
  console.log("  " + "─".repeat(110));
  console.log(
    "  " +
      "source_type".padEnd(20) +
      "sev".padEnd(10) +
      "decision".padEnd(14) +
      "operational".padEnd(14) +
      "act".padEnd(5) +
      "evi".padEnd(5) +
      "rel".padEnd(5) +
      "title"
  );
  for (const r of findings.rows) {
    console.log(
      "  " +
        String(r.source_type).padEnd(20) +
        String(r.severity).padEnd(10) +
        String(r.decision_state).padEnd(14) +
        String(r.operational_status).padEnd(14) +
        String(r.actions).padEnd(5) +
        String(r.evidence).padEnd(5) +
        String(r.related).padEnd(5) +
        String(r.title).slice(0, 60)
    );
  }

  console.log(`
  Expected reads (verify these by eye):
    - cyber_signal findings      related = 1  (F1 and F2 share a source_id)
    - control_test findings      related = 1  (F4 and F5 share a control_assessment)
    - intelligence_event finding related = 0  ← STRUCTURAL. A partial unique index
                                                forbids a second row. This zero is a
                                                CODE DEFECT, not a data gap.
    - manual finding             related = 0, all affected buckets "not applicable"
    - F2 operational = remediated   (action closed + evidence → gate satisfied)
    - F4 operational = in_progress  (action closed, NO evidence → gate HOLDS it)

  Business impact panel: Revenue and Customer will read "Not assessed" no matter
  what is seeded — they are hardcoded literals at findingRiskScore.ts:188-189.
  Third-party / Regulatory / Operational DO compute from the affected counts above.

  Feature flags required on the staging engine AND the staging Next app:
    SECURELOGIC_DECISION_WORKSPACE_ENABLED=true
    SECURELOGIC_INTELLIGENCE_EVENTS_ENABLED=true
`);
}

// ─── Org ─────────────────────────────────────────────────────────────────────

/** Create-or-reuse the walkthrough org, and re-assert the properties the flow needs. */
export async function ensureWalkthroughOrg(c: PoolClient): Promise<string> {
  const orgId = await upsertId(
    c,
    `INSERT INTO organizations
       (name, slug, plan, status, entitlement_level, scale, regulated, handles_pii,
        max_monitored_entities, enterprise_context_capability, core_platform_capability)
     VALUES ($1, $2, 'platform', 'active', 'platform', 'Medium', TRUE, TRUE, 50, TRUE, TRUE)
     ON CONFLICT (slug) DO NOTHING RETURNING id`,
    [WALKTHROUGH_NAME, WALKTHROUGH_SLUG],
    `SELECT id FROM organizations WHERE slug = $1`,
    [WALKTHROUGH_SLUG]
  );
  // Re-assert the capability flags on an existing org — entitlement_level 'platform'
  // is what clears requireEntitlement("premium"), which every risk-acceptance route
  // and the Decision Workspace context route sit behind.
  //
  // require_mfa is forced FALSE: customerAuth.ts blocks login outright when the org
  // requires MFA and the user has not enrolled, which would make the seeded
  // credentials unusable. It defaults FALSE, but an operator can flip it on any org,
  // so the walkthrough asserts it rather than assuming it.
  await c.query(
    `UPDATE organizations
        SET entitlement_level = 'platform', plan = 'platform', status = 'active',
            enterprise_context_capability = TRUE, core_platform_capability = TRUE,
            require_mfa = FALSE,
            updated_at = NOW()
      WHERE id = $1`,
    [orgId]
  );
  return orgId;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const c = await pool.connect();
  try {
    // Prod guard — outside the transaction, fail before anything opens.
    const db = await c.query<{ db: string }>(`SELECT current_database() AS db`);
    const dbName = db.rows[0].db;
    if (dbName === PROD_DB_NAME) {
      throw new Error(
        `REFUSING TO RUN: connected to the production database ('${dbName}'). ` +
          `This script only runs against staging.`
      );
    }
    console.log(`\n  Database : ${dbName}  (not prod — OK)`);

    await c.query("BEGIN");

    // Resolve the target org.
    let orgId: string;
    if (ORG_ID_ARG) {
      const r = await c.query<{ id: string; name: string; slug: string }>(
        `SELECT id, name, slug FROM organizations WHERE id = $1`,
        [ORG_ID_ARG]
      );
      if (!r.rows[0]) throw new Error(`No organization with id ${ORG_ID_ARG}`);
      const { slug, name } = r.rows[0];
      if (/dogfood/i.test(slug) || /dogfood/i.test(name)) {
        throw new Error(`REFUSING TO RUN: ${ORG_ID_ARG} is the dogfood org ('${name}').`);
      }
      orgId = r.rows[0].id;
      console.log(`  Org      : ${name} (${slug}) [${orgId}]  — supplied via --org-id`);
    } else {
      orgId = await ensureWalkthroughOrg(c);
      console.log(`  Org      : ${WALKTHROUGH_NAME} (${WALKTHROUGH_SLUG}) [${orgId}]`);
    }

    // Satisfy RLS whether we are the owner (bypasses) or app_request (does not).
    await c.query(`SELECT set_config('app.current_org_id', $1, true)`, [orgId]);

    if (SUMMARY_ONLY) {
      await printSummary(c, orgId);
      await c.query("ROLLBACK");
      console.log("  Mode     : --summary (nothing written)\n");
      return;
    }

    if (RESET || TEARDOWN_ONLY) {
      console.log("  Teardown : deleting all seeded rows for this org...");
      await teardown(c, orgId);
      if (TEARDOWN_ONLY) {
        await c.query("COMMIT");
        console.log("  Done     : teardown complete. Org row retained.\n");
        return;
      }
    }

    console.log("  Seeding  : upserting walkthrough dataset...");
    await seed(c, orgId);
    await printSummary(c, orgId);
    await c.query("COMMIT");
    console.log("  Committed.\n");
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    console.error("\n  FAILED — transaction rolled back. Nothing was written.");
    console.error(`  ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  } finally {
    c.release();
    await pool.end();
  }
}

// Only run when invoked as a script. The teardown/seed regression test imports the
// functions above, and importing must not kick off a seed or open the module pool.
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) void main();
