/**
 * scripts/seed-staging.ts
 *
 * Seeds the canonical "Staging Inc" organization on the staging DB with realistic
 * platform-entity inventory so the auto-matcher (cyberSignalProcessingService) has
 * targets to match against. All entities prefixed [STG] so this data is never
 * confused with prod or demo.
 *
 * Usage:
 *   npm run seed:staging
 *
 * Behavior:
 *   1. Verify the connection is NOT prod (current_database != 'securelogic').
 *   2. Find canonical Staging Inc org (most recent of N matching by name).
 *   3. Print chosen org id + 5s pause window for operator ctrl-C.
 *   4. Single-transaction seed of vendors / ai_systems / controls / obligations.
 *   5. Idempotent — re-running inserts only what's missing.
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

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ─── Seed data ───────────────────────────────────────────────────────────────

// 10 vendors — mix of brand-only (likely to match adapter outputs) and
// compound names (will NOT match brand-only adapter outputs). Designed to
// exercise both matcher hit and miss cases per the audit document §1.4.
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
  { name: "[STG] Microsoft",            category: "Productivity",  criticality: "high",     data_sensitivity: "confidential", access_level: "read_write",     service_description: "Office 365 productivity suite and Entra ID identity" },
  { name: "[STG] Cisco",                category: "Networking",    criticality: "high",     data_sensitivity: "confidential", access_level: "network_access", service_description: "Network infrastructure — switches, routers, firewalls" },
  { name: "[STG] Apple",                category: "Devices",       criticality: "medium",   data_sensitivity: "confidential", access_level: "read_write",     service_description: "Corporate Mac and iOS device fleet" },
  { name: "[STG] Adobe",                category: "Productivity",  criticality: "low",      data_sensitivity: "internal",     access_level: "read_only",      service_description: "Adobe Sign for document workflow" },
  { name: "[STG] Apache",               category: "Open Source",   criticality: "medium",   data_sensitivity: "internal",     access_level: "read_only",      service_description: "Apache Kafka for event streaming" },

  // Compound — will NOT match brand-only adapter outputs (matcher false-negative case)
  { name: "[STG] Microsoft Azure",      category: "Cloud",         criticality: "critical", data_sensitivity: "restricted",   access_level: "admin",          service_description: "Primary cloud — compute, storage, identity, data services" },
  { name: "[STG] Amazon Web Services",  category: "Cloud",         criticality: "critical", data_sensitivity: "restricted",   access_level: "admin",          service_description: "Secondary cloud — backup, disaster recovery, analytics" },
  { name: "[STG] Bloomberg Terminal",   category: "Market Data",   criticality: "high",     data_sensitivity: "confidential", access_level: "read_only",      service_description: "Market data, analytics, and trading workflow" },
  { name: "[STG] Refinitiv Eikon",      category: "Market Data",   criticality: "medium",   data_sensitivity: "internal",     access_level: "read_only",      service_description: "Reference data and research" },
  { name: "[STG] Cisco Systems",        category: "Networking",    criticality: "high",     data_sensitivity: "confidential", access_level: "network_access", service_description: "Same brand as 'Cisco' above — exercises matcher edge case" }
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
  { name: "[STG] Fraud Detection Model",            model_type: "internal-built",  use_case: "fraud detection on payment transactions",     deployment_status: "production", criticality: "high",   risk_classification: "high"   },
  { name: "[STG] Customer Support Chatbot",         model_type: "internal-built",  use_case: "customer-facing chat with PII access",        deployment_status: "production", criticality: "medium", risk_classification: "medium" },
  { name: "[STG] OpenAI GPT-4 Integration",         model_type: "vendor-supplied", use_case: "internal copilot for engineering",            deployment_status: "production", criticality: "medium", risk_classification: "medium" },
  { name: "[STG] Anthropic Claude Integration",     model_type: "vendor-supplied", use_case: "intelligence brief synthesis",                deployment_status: "production", criticality: "medium", risk_classification: "medium" },
  { name: "[STG] Document Classification Pipeline", model_type: "internal-built",  use_case: "ingest classifier for compliance documents",  deployment_status: "staging",    criticality: "low",    risk_classification: "low"    }
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
  { name: "[STG] MFA enforcement on admin accounts",        description: "MFA enforced via SSO for all admin-tier accounts",            control_type: "preventive", domain: "Identity",          control_family: "Access Control", maturity_level: "managed",   implementation_status: "implemented" },
  { name: "[STG] Encryption at rest for customer data",     description: "AES-256 for all customer-data tablespaces",                   control_type: "preventive", domain: "Cryptography",      control_family: "Encryption",     maturity_level: "managed",   implementation_status: "implemented" },
  { name: "[STG] TLS 1.3 for all data in transit",          description: "TLS 1.3 enforced on all external endpoints",                  control_type: "preventive", domain: "Cryptography",      control_family: "Encryption",     maturity_level: "optimized", implementation_status: "implemented" },
  { name: "[STG] Quarterly access reviews",                 description: "Quarterly review of all privileged access entitlements",      control_type: "detective",  domain: "Identity",          control_family: "Access Control", maturity_level: "managed",   implementation_status: "implemented" },
  { name: "[STG] Centralized audit logging",                description: "All auth and admin events forwarded to central SIEM",          control_type: "detective",  domain: "Logging",           control_family: "Monitoring",     maturity_level: "managed",   implementation_status: "implemented" },
  { name: "[STG] Vendor security questionnaire",            description: "Annual security questionnaire required for all vendors",       control_type: "preventive", domain: "Vendor Risk",       control_family: "Vendor Mgmt",    maturity_level: "defined",   implementation_status: "implemented" },
  { name: "[STG] Vendor SOC 2 evidence collection",         description: "SOC 2 Type II report required for tier-1 vendors annually",    control_type: "detective",  domain: "Vendor Risk",       control_family: "Vendor Mgmt",    maturity_level: "defined",   implementation_status: "implemented" },
  { name: "[STG] Privileged access management",             description: "PAM solution gating all production access paths",              control_type: "preventive", domain: "Identity",          control_family: "Access Control", maturity_level: "managed",   implementation_status: "implemented" },
  { name: "[STG] Security incident response runbook",       description: "Documented runbook with quarterly tabletop exercises",         control_type: "corrective", domain: "Incident Response", control_family: "IR",             maturity_level: "managed",   implementation_status: "implemented" }
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
  { title: "[STG] GDPR Art. 32 — Security of processing",        description: "Implement appropriate technical and organisational measures to ensure security of processing", source_regulation: "GDPR Art. 32",     jurisdiction: "EU", domain: "Privacy",    status: "active", priority: "near_term" },
  { title: "[STG] GDPR Art. 33 — Breach notification (72h)",      description: "Notify supervisory authority within 72 hours of becoming aware of a personal data breach",     source_regulation: "GDPR Art. 33",     jurisdiction: "EU", domain: "Privacy",    status: "active", priority: "immediate" },
  { title: "[STG] HIPAA §164.308 — Administrative safeguards",   description: "Implement administrative actions and policies to manage security",                              source_regulation: "HIPAA §164.308",   jurisdiction: "US", domain: "Healthcare", status: "active", priority: "planned"   },
  { title: "[STG] HIPAA §164.312 — Technical safeguards",        description: "Implement technical policies and procedures for ePHI access control",                           source_regulation: "HIPAA §164.312",   jurisdiction: "US", domain: "Healthcare", status: "active", priority: "planned"   },
  { title: "[STG] SOC 2 CC6.1 — Logical access controls",        description: "Restrict logical access to information assets to authorized users",                             source_regulation: "SOC 2 CC6.1",      jurisdiction: "US", domain: "Audit",      status: "active", priority: "near_term" },
  { title: "[STG] NIST CSF PR.AC-1 — Identity management",       description: "Identities and credentials are issued, managed, verified, and revoked",                         source_regulation: "NIST CSF PR.AC-1", jurisdiction: "US", domain: "General",    status: "active", priority: "planned"   },
  { title: "[STG] NIST CSF DE.CM-1 — Network monitoring",        description: "Networks and network services are monitored to detect cybersecurity events",                    source_regulation: "NIST CSF DE.CM-1", jurisdiction: "US", domain: "General",    status: "active", priority: "planned"   }
];

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("SecureLogic staging seed — [STG]-prefixed entities");

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

  // 3. Pause window for operator ctrl-C
  console.log("  ⏳ Seeding starts in 5 seconds. Ctrl-C to abort.");
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // 4. Single-transaction seed
  const client = await pool.connect();
  let inserted = { vendors: 0, ai_systems: 0, controls: 0, obligations: 0 };

  try {
    await client.query("BEGIN");

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

  // 5. Final tally — distinguish "newly inserted" from "already-present"
  const tally = await pool.query<{ v: string; s: string; c: string; o: string }>(
    `SELECT
       (SELECT COUNT(*)::text FROM vendors     WHERE organization_id = $1 AND name  LIKE '[STG]%') AS v,
       (SELECT COUNT(*)::text FROM ai_systems  WHERE organization_id = $1 AND name  LIKE '[STG]%') AS s,
       (SELECT COUNT(*)::text FROM controls    WHERE organization_id = $1 AND name  LIKE '[STG]%') AS c,
       (SELECT COUNT(*)::text FROM obligations WHERE organization_id = $1 AND title LIKE '[STG]%') AS o`,
    [orgId]
  );
  const t = tally.rows[0]!;

  console.log("");
  console.log("=== Seed complete (single transaction committed) ===");
  console.log(`Org id            : ${orgId}`);
  console.log(`Newly inserted    : ${inserted.vendors} vendors, ${inserted.ai_systems} ai_systems, ${inserted.controls} controls, ${inserted.obligations} obligations`);
  console.log(`Total [STG] now   : ${t.v} vendors, ${t.s} ai_systems, ${t.c} controls, ${t.o} obligations`);

  await pool.end();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
