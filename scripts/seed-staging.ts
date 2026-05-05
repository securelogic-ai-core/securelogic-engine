/**
 * scripts/seed-staging.ts
 *
 * Seeds the canonical "Staging Inc" organization on the staging DB with realistic
 * platform-entity inventory so the auto-matcher (cyberSignalProcessingService) has
 * targets to match against.
 *
 * Names are unprefixed ("Microsoft", "Cisco Systems", etc.) so they match the shape
 * of real adapter outputs. Tenant isolation is enforced by the prod-guard below
 * (current_database != 'securelogic'), not by string prefixes.
 *
 * Usage:
 *   npm run seed:staging              # idempotent: errors if legacy [STG] rows exist
 *   npm run seed:staging -- --reset   # deletes legacy [STG]-prefixed rows first
 *
 * Behavior:
 *   1. Verify the connection is NOT prod (current_database != 'securelogic').
 *   2. Find canonical Staging Inc org (most recent of N matching by name).
 *   3. If !--reset and any [STG]-prefixed rows exist for this org from a prior
 *      seed-script version, error out and instruct the operator to use --reset.
 *   4. Print chosen org id + 5s pause window for operator ctrl-C.
 *   5. Single transaction: optional DELETE of [STG] rows (--reset only), then
 *      idempotent INSERT of clean unprefixed entities.
 *
 * Constraints:
 *   - Refuses to run against prod.
 *   - Errors on 0 or >4 'Staging Inc' orgs.
 *   - Rolls back the entire seed transaction on any error.
 *
 * NOT in scope:
 *   - cyber_signals (separate flow once seed data is in place).
 *   - link tables (signal_vendor_links etc.).
 *   - schema modifications.
 *   - Staging2 Inc.
 */

import { config } from "dotenv";
// .env.local wins over .env. Shell-provided DATABASE_URL wins over both
// because override is not set.
config({ path: ".env.local" });
config({ path: ".env" });

import { Pool } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL not set");
  process.exit(1);
}

const RESET = process.argv.includes("--reset");

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ─── Seed data — UNPREFIXED so names match real adapter outputs ──────────────

// 10 vendors — mix of brand-only (likely matcher hits) and compound names
// (likely matcher misses against brand-only adapter outputs). Diagnostic of
// the audit doc §1.4 finding about ILIKE-without-wildcards.
type VendorDef = {
  name: string;
  category: string;
  criticality: string;
  data_sensitivity: string;
  access_level: string;
  service_description: string;
};

const VENDORS: VendorDef[] = [
  // Brand-only — exact-match candidates against CISA KEV / NVD output
  { name: "Microsoft",            category: "Productivity",  criticality: "high",     data_sensitivity: "confidential", access_level: "read_write",     service_description: "Office 365 productivity suite and Entra ID identity" },
  { name: "Cisco",                category: "Networking",    criticality: "high",     data_sensitivity: "confidential", access_level: "network_access", service_description: "Network infrastructure — switches, routers, firewalls" },
  { name: "Apple",                category: "Devices",       criticality: "medium",   data_sensitivity: "confidential", access_level: "read_write",     service_description: "Corporate Mac and iOS device fleet" },
  { name: "Adobe",                category: "Productivity",  criticality: "low",      data_sensitivity: "internal",     access_level: "read_only",      service_description: "Adobe Sign for document workflow" },
  { name: "Apache",               category: "Open Source",   criticality: "medium",   data_sensitivity: "internal",     access_level: "read_only",      service_description: "Apache Kafka for event streaming" },

  // Compound — will NOT match brand-only adapter outputs (matcher false-negative case)
  { name: "Microsoft Azure",      category: "Cloud",         criticality: "critical", data_sensitivity: "restricted",   access_level: "admin",          service_description: "Primary cloud — compute, storage, identity, data services" },
  { name: "Amazon Web Services",  category: "Cloud",         criticality: "critical", data_sensitivity: "restricted",   access_level: "admin",          service_description: "Secondary cloud — backup, disaster recovery, analytics" },
  { name: "Bloomberg Terminal",   category: "Market Data",   criticality: "high",     data_sensitivity: "confidential", access_level: "read_only",      service_description: "Market data, analytics, and trading workflow" },
  { name: "Refinitiv Eikon",      category: "Market Data",   criticality: "medium",   data_sensitivity: "internal",     access_level: "read_only",      service_description: "Reference data and research" },
  { name: "Cisco Systems",        category: "Networking",    criticality: "high",     data_sensitivity: "confidential", access_level: "network_access", service_description: "Same brand as 'Cisco' above — exercises matcher edge case" }
];

// 5 AI systems — mix internal-built and vendor-supplied
type AiSystemDef = {
  name: string;
  model_type: string;
  use_case: string;
  deployment_status: string;
  criticality: string;
  risk_classification: string;
};

const AI_SYSTEMS: AiSystemDef[] = [
  { name: "Fraud Detection Model",            model_type: "internal-built",  use_case: "fraud detection on payment transactions",     deployment_status: "production", criticality: "high",   risk_classification: "high"   },
  { name: "Customer Support Chatbot",         model_type: "internal-built",  use_case: "customer-facing chat with PII access",        deployment_status: "production", criticality: "medium", risk_classification: "medium" },
  { name: "OpenAI GPT-4 Integration",         model_type: "vendor-supplied", use_case: "internal copilot for engineering",            deployment_status: "production", criticality: "medium", risk_classification: "medium" },
  { name: "Anthropic Claude Integration",     model_type: "vendor-supplied", use_case: "intelligence brief synthesis",                deployment_status: "production", criticality: "medium", risk_classification: "medium" },
  { name: "Document Classification Pipeline", model_type: "internal-built",  use_case: "ingest classifier for compliance documents",  deployment_status: "staging",    criticality: "low",    risk_classification: "low"    }
];

// 9 controls — access control, encryption, MFA, logging, vendor management
type ControlDef = {
  name: string;
  description: string;
  control_type: string;
  domain: string;
  control_family: string;
  maturity_level: string;
  implementation_status: string;
};

const CONTROLS: ControlDef[] = [
  { name: "MFA enforcement on admin accounts",        description: "MFA enforced via SSO for all admin-tier accounts",            control_type: "preventive", domain: "Identity",          control_family: "Access Control", maturity_level: "managed",   implementation_status: "implemented" },
  { name: "Encryption at rest for customer data",     description: "AES-256 for all customer-data tablespaces",                   control_type: "preventive", domain: "Cryptography",      control_family: "Encryption",     maturity_level: "managed",   implementation_status: "implemented" },
  { name: "TLS 1.3 for all data in transit",          description: "TLS 1.3 enforced on all external endpoints",                  control_type: "preventive", domain: "Cryptography",      control_family: "Encryption",     maturity_level: "optimized", implementation_status: "implemented" },
  { name: "Quarterly access reviews",                 description: "Quarterly review of all privileged access entitlements",      control_type: "detective",  domain: "Identity",          control_family: "Access Control", maturity_level: "managed",   implementation_status: "implemented" },
  { name: "Centralized audit logging",                description: "All auth and admin events forwarded to central SIEM",          control_type: "detective",  domain: "Logging",           control_family: "Monitoring",     maturity_level: "managed",   implementation_status: "implemented" },
  { name: "Vendor security questionnaire",            description: "Annual security questionnaire required for all vendors",       control_type: "preventive", domain: "Vendor Risk",       control_family: "Vendor Mgmt",    maturity_level: "defined",   implementation_status: "implemented" },
  { name: "Vendor SOC 2 evidence collection",         description: "SOC 2 Type II report required for tier-1 vendors annually",    control_type: "detective",  domain: "Vendor Risk",       control_family: "Vendor Mgmt",    maturity_level: "defined",   implementation_status: "implemented" },
  { name: "Privileged access management",             description: "PAM solution gating all production access paths",              control_type: "preventive", domain: "Identity",          control_family: "Access Control", maturity_level: "managed",   implementation_status: "implemented" },
  { name: "Security incident response runbook",       description: "Documented runbook with quarterly tabletop exercises",         control_type: "corrective", domain: "Incident Response", control_family: "IR",             maturity_level: "managed",   implementation_status: "implemented" }
];

// 7 obligations spanning GDPR / HIPAA / SOC 2 / NIST CSF
type ObligationDef = {
  title: string;
  description: string;
  source_regulation: string;
  jurisdiction: string;
  domain: string;
  status: string;
  priority: string;
};

const OBLIGATIONS: ObligationDef[] = [
  { title: "GDPR Art. 32 — Security of processing",        description: "Implement appropriate technical and organisational measures to ensure security of processing", source_regulation: "GDPR Art. 32",     jurisdiction: "EU", domain: "Privacy",    status: "active", priority: "near_term" },
  { title: "GDPR Art. 33 — Breach notification (72h)",      description: "Notify supervisory authority within 72 hours of becoming aware of a personal data breach",     source_regulation: "GDPR Art. 33",     jurisdiction: "EU", domain: "Privacy",    status: "active", priority: "immediate" },
  { title: "HIPAA §164.308 — Administrative safeguards",   description: "Implement administrative actions and policies to manage security",                              source_regulation: "HIPAA §164.308",   jurisdiction: "US", domain: "Healthcare", status: "active", priority: "planned"   },
  { title: "HIPAA §164.312 — Technical safeguards",        description: "Implement technical policies and procedures for ePHI access control",                           source_regulation: "HIPAA §164.312",   jurisdiction: "US", domain: "Healthcare", status: "active", priority: "planned"   },
  { title: "SOC 2 CC6.1 — Logical access controls",        description: "Restrict logical access to information assets to authorized users",                             source_regulation: "SOC 2 CC6.1",      jurisdiction: "US", domain: "Audit",      status: "active", priority: "near_term" },
  { title: "NIST CSF PR.AC-1 — Identity management",       description: "Identities and credentials are issued, managed, verified, and revoked",                         source_regulation: "NIST CSF PR.AC-1", jurisdiction: "US", domain: "General",    status: "active", priority: "planned"   },
  { title: "NIST CSF DE.CM-1 — Network monitoring",        description: "Networks and network services are monitored to detect cybersecurity events",                    source_regulation: "NIST CSF DE.CM-1", jurisdiction: "US", domain: "General",    status: "active", priority: "planned"   }
];

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`SecureLogic staging seed${RESET ? " (--reset)" : ""}`);

  // 1. Pre-flight: NOT prod
  const dbResult = await pool.query<{ db: string }>("SELECT current_database() AS db");
  const dbName = dbResult.rows[0]?.db;
  if (dbName === "securelogic") {
    console.error(`ERROR: refusing to seed against prod (current_database='${dbName}'). Aborting.`);
    await pool.end();
    process.exit(1);
  }
  if (!dbName) {
    console.error("ERROR: could not determine current_database. Aborting.");
    await pool.end();
    process.exit(1);
  }
  console.log(`  ✓ DB: ${dbName} (not prod)`);

  // 2. Find canonical Staging Inc org
  const orgRows = await pool.query<{ id: string; created_at: string }>(
    `SELECT id, created_at
       FROM organizations
      WHERE name = 'Staging Inc'
      ORDER BY created_at DESC`
  );
  const orgCount = orgRows.rowCount ?? 0;

  if (orgCount === 0 || orgCount > 4) {
    console.error(`ERROR: expected 1-4 'Staging Inc' orgs, found ${orgCount}.`);
    if (orgCount > 0) {
      console.error("Found:");
      for (const r of orgRows.rows) {
        console.error(`  ${r.id}  ${r.created_at}`);
      }
    }
    await pool.end();
    process.exit(1);
  }

  const chosen = orgRows.rows[0]!;
  const orgId = chosen.id;
  console.log(`  ✓ Found ${orgCount} 'Staging Inc' org(s); choosing most recent:`);
  console.log(`    org_id     : ${chosen.id}`);
  console.log(`    created_at : ${chosen.created_at}`);

  // 3. Detect legacy [STG] rows from a prior version of this script.
  //    Without --reset, error out so the operator decides explicitly.
  const stgCountResult = await pool.query<{ v: number; s: number; c: number; o: number }>(
    `SELECT
       (SELECT COUNT(*)::int FROM vendors     WHERE organization_id = $1 AND name  LIKE '[STG]%') AS v,
       (SELECT COUNT(*)::int FROM ai_systems  WHERE organization_id = $1 AND name  LIKE '[STG]%') AS s,
       (SELECT COUNT(*)::int FROM controls    WHERE organization_id = $1 AND name  LIKE '[STG]%') AS c,
       (SELECT COUNT(*)::int FROM obligations WHERE organization_id = $1 AND title LIKE '[STG]%') AS o`,
    [orgId]
  );
  const stg = stgCountResult.rows[0]!;
  const stgTotal = stg.v + stg.s + stg.c + stg.o;

  if (stgTotal > 0 && !RESET) {
    console.error("");
    console.error(`ERROR: legacy [STG]-prefixed rows exist for org ${orgId}:`);
    console.error(`  vendors: ${stg.v}, ai_systems: ${stg.s}, controls: ${stg.c}, obligations: ${stg.o}`);
    console.error("");
    console.error("These rows are from a prior seed-script version that prefixed entity names with [STG].");
    console.error("The current script seeds unprefixed names so the matcher can match real adapter outputs.");
    console.error("To remove the legacy rows and re-seed, run:");
    console.error("  npm run seed:staging -- --reset");
    await pool.end();
    process.exit(1);
  }

  // 4. Pause window for operator ctrl-C
  console.log("  ⏳ Seeding starts in 5 seconds. Ctrl-C to abort.");
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // 5. Single-transaction seed (with optional --reset DELETE first)
  const client = await pool.connect();
  let deleted = { vendors: 0, ai_systems: 0, controls: 0, obligations: 0 };
  let inserted = { vendors: 0, ai_systems: 0, controls: 0, obligations: 0 };

  try {
    await client.query("BEGIN");

    if (RESET) {
      const dv = await client.query(
        `DELETE FROM vendors WHERE organization_id = $1 AND name LIKE '[STG]%'`,
        [orgId]
      );
      const ds = await client.query(
        `DELETE FROM ai_systems WHERE organization_id = $1 AND name LIKE '[STG]%'`,
        [orgId]
      );
      const dc = await client.query(
        `DELETE FROM controls WHERE organization_id = $1 AND name LIKE '[STG]%'`,
        [orgId]
      );
      const do_ = await client.query(
        `DELETE FROM obligations WHERE organization_id = $1 AND title LIKE '[STG]%'`,
        [orgId]
      );
      deleted = {
        vendors: dv.rowCount ?? 0,
        ai_systems: ds.rowCount ?? 0,
        controls: dc.rowCount ?? 0,
        obligations: do_.rowCount ?? 0
      };
    }

    // Vendors
    for (const v of VENDORS) {
      const r = await client.query(
        `INSERT INTO vendors
           (organization_id, name, category, criticality, data_sensitivity,
            access_level, service_description, status)
         SELECT $1, $2, $3, $4, $5, $6, $7, 'active'
          WHERE NOT EXISTS (
            SELECT 1 FROM vendors WHERE organization_id = $1 AND name = $2
          )`,
        [orgId, v.name, v.category, v.criticality, v.data_sensitivity,
         v.access_level, v.service_description]
      );
      if ((r.rowCount ?? 0) > 0) inserted.vendors++;
    }

    // AI systems
    for (const s of AI_SYSTEMS) {
      const r = await client.query(
        `INSERT INTO ai_systems
           (organization_id, name, model_type, use_case, deployment_status,
            criticality, risk_classification)
         SELECT $1, $2, $3, $4, $5, $6, $7
          WHERE NOT EXISTS (
            SELECT 1 FROM ai_systems WHERE organization_id = $1 AND name = $2
          )`,
        [orgId, s.name, s.model_type, s.use_case, s.deployment_status,
         s.criticality, s.risk_classification]
      );
      if ((r.rowCount ?? 0) > 0) inserted.ai_systems++;
    }

    // Controls
    for (const c of CONTROLS) {
      const r = await client.query(
        `INSERT INTO controls
           (organization_id, name, description, control_type, domain,
            control_family, maturity_level, implementation_status, status)
         SELECT $1, $2, $3, $4, $5, $6, $7, $8, 'active'
          WHERE NOT EXISTS (
            SELECT 1 FROM controls WHERE organization_id = $1 AND name = $2
          )`,
        [orgId, c.name, c.description, c.control_type, c.domain,
         c.control_family, c.maturity_level, c.implementation_status]
      );
      if ((r.rowCount ?? 0) > 0) inserted.controls++;
    }

    // Obligations
    for (const o of OBLIGATIONS) {
      const r = await client.query(
        `INSERT INTO obligations
           (organization_id, title, description, source_regulation, jurisdiction,
            domain, status, priority)
         SELECT $1, $2, $3, $4, $5, $6, $7, $8
          WHERE NOT EXISTS (
            SELECT 1 FROM obligations WHERE organization_id = $1 AND title = $2
          )`,
        [orgId, o.title, o.description, o.source_regulation, o.jurisdiction,
         o.domain, o.status, o.priority]
      );
      if ((r.rowCount ?? 0) > 0) inserted.obligations++;
    }

    await client.query("COMMIT");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback failure
    }
    console.error("ERROR during seed transaction (rolled back):", err);
    client.release();
    await pool.end();
    process.exit(1);
  }

  client.release();

  // 6. Final tally — count ALL entities for this org (no name filter), since
  //    seeded names are now unprefixed and indistinguishable from any other
  //    legitimate platform data.
  const tally = await pool.query<{ v: string; s: string; c: string; o: string }>(
    `SELECT
       (SELECT COUNT(*)::text FROM vendors     WHERE organization_id = $1) AS v,
       (SELECT COUNT(*)::text FROM ai_systems  WHERE organization_id = $1) AS s,
       (SELECT COUNT(*)::text FROM controls    WHERE organization_id = $1) AS c,
       (SELECT COUNT(*)::text FROM obligations WHERE organization_id = $1) AS o`,
    [orgId]
  );
  const t = tally.rows[0]!;

  console.log("");
  console.log("=== Seed complete (single transaction committed) ===");
  console.log(`Org id            : ${orgId}`);
  if (RESET) {
    console.log(`Deleted (--reset) : ${deleted.vendors} vendors, ${deleted.ai_systems} ai_systems, ${deleted.controls} controls, ${deleted.obligations} obligations`);
  }
  console.log(`Newly inserted    : ${inserted.vendors} vendors, ${inserted.ai_systems} ai_systems, ${inserted.controls} controls, ${inserted.obligations} obligations`);
  console.log(`Total for org now : ${t.v} vendors, ${t.s} ai_systems, ${t.c} controls, ${t.o} obligations`);

  await pool.end();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
