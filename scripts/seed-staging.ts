/**
 * scripts/seed-staging.ts
 *
 * Seeds the canonical "Staging Inc" organization on the staging DB with realistic
 * platform-entity inventory so the auto-matcher (cyberSignalProcessingService) has
 * targets to match against, plus a risk register dataset so the operator can test
 * the risk-register UI packages (table view, treatments, inherent vs residual).
 *
 * Naming convention:
 *   - vendors / ai_systems / controls / obligations: UNPREFIXED ("Microsoft",
 *     "Cisco Systems", etc.) so names match real adapter outputs for matcher tests.
 *   - findings / risks / risk_treatments: PREFIXED with "[STG] " so they are
 *     identifiable as seed data and cleanly removable via --reset.
 *
 * Tenant isolation is enforced by the prod-guard below (current_database !=
 * 'securelogic'), not by string prefixes.
 *
 * Usage:
 *   npm run seed:staging              # idempotent: errors if legacy [STG] vendor/etc rows exist
 *   npm run seed:staging -- --reset   # deletes [STG]-prefixed rows across all in-scope tables first
 *
 * Behavior:
 *   1. Verify the connection is NOT prod (current_database != 'securelogic').
 *   2. Find canonical Staging Inc org (most recent of N matching by name).
 *   3. If !--reset and any [STG]-prefixed rows exist for this org in
 *      vendors/ai_systems/controls/obligations from a prior seed-script version
 *      (when those entity names were prefixed), error out and instruct the operator
 *      to use --reset. Risks/findings/treatments are intentionally [STG]-prefixed
 *      and use NOT EXISTS for idempotency — no error, just skipped on re-run.
 *   4. Print chosen org id + 5s pause window for operator ctrl-C.
 *   5. Single transaction: optional DELETE of [STG] rows (--reset only), then
 *      idempotent INSERT of (a) clean unprefixed matcher targets, (b) [STG]-prefixed
 *      findings, risks, and risk_treatments.
 *
 * Insert order (FK-respecting):
 *   findings  →  risks (may reference findings via source_id)  →  risk_treatments
 *   (vendors / ai_systems / controls / obligations are independent of the above)
 *
 * Idempotency rules:
 *   - vendors / ai_systems / controls / obligations: NOT EXISTS on (org_id, name|title).
 *   - findings: NOT EXISTS on (org_id, title); look up id afterward so risks can link.
 *   - risks: NOT EXISTS on (org_id, title). If risk pre-existed, SKIP its treatments
 *     entirely — do not top up partial state.
 *   - risk_treatments: NOT EXISTS on (risk_id, summary), only attempted for newly-
 *     inserted risks.
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

// 5 findings — all status='open', spanning severity Moderate→Critical.
// Source rows (vendor_reviews, control_tests, etc.) are not seeded by this
// script, so source_type='manual' and source_id=NULL across the board. The
// conceptual source is encoded in the title.
type FindingDef = {
  title: string;
  severity: string;
  domain: string;
  description: string;
  source_type: string;
};

const FINDINGS: FindingDef[] = [
  { title: "[STG] Unpatched RDP exposure on legacy VPN concentrator", severity: "High",     domain: "Vulnerability",     source_type: "manual", description: "Vulnerability scanner identified RDP exposed on the legacy VPN concentrator awaiting decommission." },
  { title: "[STG] Vendor SOC 2 report not yet reviewed",              severity: "Moderate", domain: "Vendor Risk",       source_type: "manual", description: "SOC 2 Type II report received from a tier-1 SaaS vendor; security review not yet scheduled." },
  { title: "[STG] AI training data lineage gap",                      severity: "High",     domain: "AI Governance",     source_type: "manual", description: "Production model lacks documented lineage for portions of its training corpus." },
  { title: "[STG] HIPAA BAA missing for one subprocessor",            severity: "Critical", domain: "Regulatory",        source_type: "manual", description: "A subprocessor with potential PHI access does not have a Business Associate Agreement on file." },
  { title: "[STG] Production secrets rotation overdue",               severity: "Critical", domain: "Access Management", source_type: "manual", description: "Production secrets last rotated outside the 90-day cadence policy." }
];

// 10 risks across all 7 domains, varied state. Each row carries explicit
// values for all 9 rating fields (legacy trio + inherent trio + residual trio)
// per the Phase 1 contract. Per Phase 2 docs, legacy = residual semantically;
// the schema requires legacy NOT NULL, so for R9 (residual NULL) legacy mirrors
// inherent instead. For R10 (inherent NULL) legacy mirrors residual.
//
// Risks with status='mitigated' / 'accepted' / 'transferred' have a matching
// terminal-status treatment in TREATMENTS — this mimics the route handler's
// atomic risk↔treatment status sync rule when the operator drives those
// transitions through the API.
type RiskDef = {
  title: string;
  domain: string;
  status: string;
  owner: string | null;
  due_date: string | null;
  legacy_likelihood: string;
  legacy_impact: string;
  legacy_risk_rating: string;
  inherent_likelihood: string | null;
  inherent_impact: string | null;
  inherent_rating: string | null;
  residual_likelihood: string | null;
  residual_impact: string | null;
  residual_rating: string | null;
  linked_finding_title: string | null;
};

const RISKS: RiskDef[] = [
  {
    title: "[STG] Privileged Access Sprawl",
    domain: "Access Management", status: "open",
    owner: "Alice Chen", due_date: "2026-06-15",
    legacy_likelihood: "likely",       legacy_impact: "High",     legacy_risk_rating: "High",
    inherent_likelihood: "very_likely", inherent_impact: "Critical", inherent_rating: "Critical",
    residual_likelihood: "likely",      residual_impact: "High",     residual_rating: "High",
    linked_finding_title: "[STG] Unpatched RDP exposure on legacy VPN concentrator"
  },
  {
    title: "[STG] Critical SaaS Vendor Without SOC 2",
    domain: "Vendor Risk", status: "open",
    owner: "Marcus Reed", due_date: "2026-05-30",
    legacy_likelihood: "possible",     legacy_impact: "Moderate", legacy_risk_rating: "Moderate",
    inherent_likelihood: "likely",     inherent_impact: "High",     inherent_rating: "High",
    residual_likelihood: "possible",   residual_impact: "Moderate", residual_rating: "Moderate",
    linked_finding_title: "[STG] Vendor SOC 2 report not yet reviewed"
  },
  {
    title: "[STG] LLM Training Data Provenance Unknown",
    domain: "AI Governance", status: "open",
    owner: "Priya Patel", due_date: "2026-07-01",
    legacy_likelihood: "possible",     legacy_impact: "High",     legacy_risk_rating: "High",
    inherent_likelihood: "likely",     inherent_impact: "High",   inherent_rating: "High",
    residual_likelihood: "possible",   residual_impact: "High",   residual_rating: "High",
    linked_finding_title: "[STG] AI training data lineage gap"
  },
  {
    // Inherent == residual: tests "controls add no mitigation" case.
    title: "[STG] HIPAA Subprocessor Without BAA",
    domain: "Regulatory", status: "open",
    owner: "Legal Team", due_date: "2026-05-15",
    legacy_likelihood: "very_likely",   legacy_impact: "Critical", legacy_risk_rating: "Critical",
    inherent_likelihood: "very_likely", inherent_impact: "Critical", inherent_rating: "Critical",
    residual_likelihood: "very_likely", residual_impact: "Critical", residual_rating: "Critical",
    linked_finding_title: "[STG] HIPAA BAA missing for one subprocessor"
  },
  {
    // Unowned, no due date, no linked finding, no treatments:
    // tests the bare-minimum "freshly captured risk" state.
    title: "[STG] Outdated TLS on Legacy Reporting Service",
    domain: "Vulnerability", status: "open",
    owner: null, due_date: null,
    legacy_likelihood: "unlikely",     legacy_impact: "Low",       legacy_risk_rating: "Low",
    inherent_likelihood: "possible",   inherent_impact: "Moderate", inherent_rating: "Moderate",
    residual_likelihood: "unlikely",   residual_impact: "Low",     residual_rating: "Low",
    linked_finding_title: null
  },
  {
    title: "[STG] Secondary DC Cooling Single Point of Failure",
    domain: "Resilience", status: "open",
    owner: "Ops Team", due_date: "2026-09-30",
    legacy_likelihood: "unlikely",     legacy_impact: "High",     legacy_risk_rating: "Moderate",
    inherent_likelihood: "unlikely",   inherent_impact: "Critical", inherent_rating: "High",
    residual_likelihood: "unlikely",   residual_impact: "High",     residual_rating: "Moderate",
    linked_finding_title: null
  },
  {
    // Terminal status with two treatments: tests the mixed-treatment-state
    // detail page (one mitigated, one in_progress) when the parent risk is
    // already in terminal mitigated state.
    title: "[STG] Tabletop Exercise Overdue",
    domain: "General", status: "mitigated",
    owner: "Security Team", due_date: "2026-04-01",
    legacy_likelihood: "rare",         legacy_impact: "Low",      legacy_risk_rating: "Low",
    inherent_likelihood: "likely",     inherent_impact: "Moderate", inherent_rating: "Moderate",
    residual_likelihood: "rare",       residual_impact: "Low",     residual_rating: "Low",
    linked_finding_title: null
  },
  {
    title: "[STG] AI Vendor Inventory Incomplete",
    domain: "AI Governance", status: "accepted",
    owner: "AI Governance Lead", due_date: null,
    legacy_likelihood: "possible",     legacy_impact: "Moderate", legacy_risk_rating: "Moderate",
    inherent_likelihood: "possible",   inherent_impact: "Moderate", inherent_rating: "Moderate",
    residual_likelihood: "possible",   residual_impact: "Moderate", residual_rating: "Moderate",
    linked_finding_title: null
  },
  {
    // Residual NULL: tests the engine's null-skip behavior (engine count
    // drops by 1 for this risk) and the table/detail "—" empty state.
    // Legacy mirrors inherent because legacy is NOT NULL.
    title: "[STG] Acquired Subsidiary's Identity Stack",
    domain: "Access Management", status: "transferred",
    owner: "M&A Integration", due_date: null,
    legacy_likelihood: "likely",       legacy_impact: "High",     legacy_risk_rating: "High",
    inherent_likelihood: "likely",     inherent_impact: "High",   inherent_rating: "High",
    residual_likelihood: null,         residual_impact: null,     residual_rating: null,
    linked_finding_title: null
  },
  {
    // Inherent NULL: backfilled-style row that demonstrates the "—" inherent
    // display on the detail page. Legacy mirrors residual.
    title: "[STG] Closed: Legacy On-Prem Email Decommission",
    domain: "Vulnerability", status: "closed",
    owner: null, due_date: null,
    legacy_likelihood: "rare",         legacy_impact: "Low",      legacy_risk_rating: "Low",
    inherent_likelihood: null,         inherent_impact: null,     inherent_rating: null,
    residual_likelihood: "rare",       residual_impact: "Low",    residual_rating: "Low",
    linked_finding_title: null
  }
];

// 10 treatments across 8 risks. R5 and R10 have zero treatments (empty-state
// testing). R1 and R7 have two each (multi-treatment modal testing).
//
// For risks whose status is terminal (mitigated/accepted/transferred), the
// matching treatment carries the same terminal status — mimicking the
// route-handler atomic-sync invariant. Direct-to-DB seed bypasses the route
// but holds the invariant by construction.
type TreatmentDef = {
  risk_title: string;
  status: string;
  treatment_type: string;
  owner: string | null;
  summary: string;
};

const TREATMENTS: TreatmentDef[] = [
  { risk_title: "[STG] Privileged Access Sprawl",                    status: "in_progress", treatment_type: "mitigate", owner: "Alice Chen", summary: "Implement privileged session monitoring" },
  { risk_title: "[STG] Privileged Access Sprawl",                    status: "not_started", treatment_type: "mitigate", owner: null,         summary: "Quarterly access reviews" },
  { risk_title: "[STG] Critical SaaS Vendor Without SOC 2",          status: "in_progress", treatment_type: "transfer", owner: null,         summary: "Procure cyber insurance rider" },
  { risk_title: "[STG] LLM Training Data Provenance Unknown",        status: "not_started", treatment_type: "mitigate", owner: null,         summary: "Deploy data lineage tooling" },
  { risk_title: "[STG] HIPAA Subprocessor Without BAA",              status: "not_started", treatment_type: "mitigate", owner: null,         summary: "Execute BAA with subprocessor" },
  { risk_title: "[STG] Secondary DC Cooling Single Point of Failure",status: "in_progress", treatment_type: "mitigate", owner: null,         summary: "Install secondary cooling unit" },
  { risk_title: "[STG] Tabletop Exercise Overdue",                   status: "mitigated",   treatment_type: "mitigate", owner: null,         summary: "Q1 tabletop completed" },
  { risk_title: "[STG] Tabletop Exercise Overdue",                   status: "in_progress", treatment_type: "mitigate", owner: null,         summary: "Q2 tabletop scheduled" },
  { risk_title: "[STG] AI Vendor Inventory Incomplete",              status: "accepted",    treatment_type: "accept",   owner: null,         summary: "Risk accepted — pending AI vendor census project Q3" },
  { risk_title: "[STG] Acquired Subsidiary's Identity Stack",        status: "transferred", treatment_type: "transfer", owner: null,         summary: "Transferred to acquiring org's risk register" }
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
  let deleted = {
    risk_treatments: 0, risks: 0, findings: 0,
    vendors: 0, ai_systems: 0, controls: 0, obligations: 0
  };
  const inserted = {
    findings: 0, risks: 0, risk_treatments: 0,
    vendors: 0, ai_systems: 0, controls: 0, obligations: 0
  };

  try {
    await client.query("BEGIN");

    if (RESET) {
      // Delete in FK-respecting order: treatments → risks → findings.
      // risk_treatments has a real FK to risks (ON DELETE RESTRICT), so it
      // must go first. risks.source_id → findings is a soft reference (no FK),
      // but we delete in dependency order anyway for clarity.
      const dt = await client.query(
        `DELETE FROM risk_treatments
          WHERE risk_id IN (
            SELECT id FROM risks
             WHERE organization_id = $1 AND title LIKE '[STG] %'
          )`,
        [orgId]
      );
      const dr = await client.query(
        `DELETE FROM risks
          WHERE organization_id = $1 AND title LIKE '[STG] %'`,
        [orgId]
      );
      const df = await client.query(
        `DELETE FROM findings
          WHERE organization_id = $1 AND title LIKE '[STG] %'`,
        [orgId]
      );
      // Legacy [STG]-prefixed entity cleanup from a prior version of this
      // script (when vendors/ai_systems/controls/obligations were prefixed).
      // Current script seeds those tables UNPREFIXED, so this is one-shot
      // legacy hygiene; matches '[STG]%' (no space) intentionally to capture
      // the legacy "[STG]Microsoft" form.
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
        risk_treatments: dt.rowCount ?? 0,
        risks: dr.rowCount ?? 0,
        findings: df.rowCount ?? 0,
        vendors: dv.rowCount ?? 0,
        ai_systems: ds.rowCount ?? 0,
        controls: dc.rowCount ?? 0,
        obligations: do_.rowCount ?? 0
      };
    }

    // Findings — insert first so risks can reference them via source_id.
    // Capture id-by-title (whether newly inserted or pre-existing) so risks
    // can resolve linked_finding_title regardless of run state.
    const findingIdByTitle = new Map<string, string>();
    for (const f of FINDINGS) {
      const r = await client.query<{ id: string }>(
        `INSERT INTO findings
           (organization_id, title, severity, domain, description, source_type, status)
         SELECT $1, $2, $3, $4, $5, $6, 'open'
          WHERE NOT EXISTS (
            SELECT 1 FROM findings WHERE organization_id = $1 AND title = $2
          )
         RETURNING id`,
        [orgId, f.title, f.severity, f.domain, f.description, f.source_type]
      );
      const newRow = r.rows[0];
      if (newRow) {
        findingIdByTitle.set(f.title, newRow.id);
        inserted.findings++;
      } else {
        const ex = await client.query<{ id: string }>(
          `SELECT id FROM findings WHERE organization_id = $1 AND title = $2`,
          [orgId, f.title]
        );
        const exRow = ex.rows[0];
        if (exRow) findingIdByTitle.set(f.title, exRow.id);
      }
    }

    // Risks — only NEWLY-inserted risks have their treatments seeded, per
    // the rule "if a risk exists, skip its treatments entirely; do not top
    // up partial state". Pre-existing risks are left fully alone.
    const newRiskIdByTitle = new Map<string, string>();
    for (const risk of RISKS) {
      const sourceId = risk.linked_finding_title
        ? findingIdByTitle.get(risk.linked_finding_title) ?? null
        : null;
      const sourceType = sourceId ? "finding" : null;

      const r = await client.query<{ id: string }>(
        `INSERT INTO risks
           (organization_id, title, domain, status, owner, due_date,
            likelihood, impact, risk_rating,
            inherent_likelihood, inherent_impact, inherent_rating,
            residual_likelihood, residual_impact, residual_rating,
            source_type, source_id)
         SELECT $1, $2, $3, $4, $5, $6,
                $7, $8, $9,
                $10, $11, $12,
                $13, $14, $15,
                $16, $17
          WHERE NOT EXISTS (
            SELECT 1 FROM risks WHERE organization_id = $1 AND title = $2
          )
         RETURNING id`,
        [
          orgId, risk.title, risk.domain, risk.status, risk.owner, risk.due_date,
          risk.legacy_likelihood, risk.legacy_impact, risk.legacy_risk_rating,
          risk.inherent_likelihood, risk.inherent_impact, risk.inherent_rating,
          risk.residual_likelihood, risk.residual_impact, risk.residual_rating,
          sourceType, sourceId
        ]
      );
      const newRow = r.rows[0];
      if (newRow) {
        newRiskIdByTitle.set(risk.title, newRow.id);
        inserted.risks++;
      }
    }

    // Risk treatments — only iterate newly-inserted risks. Cross-run safety
    // also enforced via NOT EXISTS on (risk_id, summary) in case a future
    // change to the skip rule reopens this code path.
    for (const t of TREATMENTS) {
      const riskId = newRiskIdByTitle.get(t.risk_title);
      if (!riskId) continue;

      const r = await client.query(
        `INSERT INTO risk_treatments
           (organization_id, risk_id, status, treatment_type, owner, summary)
         SELECT $1, $2, $3, $4, $5, $6
          WHERE NOT EXISTS (
            SELECT 1 FROM risk_treatments
             WHERE risk_id = $2 AND summary = $6
          )`,
        [orgId, riskId, t.status, t.treatment_type, t.owner, t.summary]
      );
      if ((r.rowCount ?? 0) > 0) inserted.risk_treatments++;
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

  // 6. Final tally — for matcher entities (vendors/ai_systems/controls/
  //    obligations) we count ALL rows for the org since names are unprefixed.
  //    For risks/findings/risk_treatments we count only [STG] rows so the
  //    tally reflects what this script seeded, not unrelated platform data.
  const tally = await pool.query<{
    v: string; s: string; c: string; o: string;
    f: string; rk: string; rt: string;
  }>(
    `SELECT
       (SELECT COUNT(*)::text FROM vendors         WHERE organization_id = $1) AS v,
       (SELECT COUNT(*)::text FROM ai_systems      WHERE organization_id = $1) AS s,
       (SELECT COUNT(*)::text FROM controls        WHERE organization_id = $1) AS c,
       (SELECT COUNT(*)::text FROM obligations     WHERE organization_id = $1) AS o,
       (SELECT COUNT(*)::text FROM findings        WHERE organization_id = $1 AND title LIKE '[STG] %') AS f,
       (SELECT COUNT(*)::text FROM risks           WHERE organization_id = $1 AND title LIKE '[STG] %') AS rk,
       (SELECT COUNT(*)::text FROM risk_treatments
          WHERE risk_id IN (SELECT id FROM risks
                             WHERE organization_id = $1 AND title LIKE '[STG] %')) AS rt`,
    [orgId]
  );
  const t = tally.rows[0]!;

  console.log("");
  console.log("=== Seed complete (single transaction committed) ===");
  console.log(`Org id            : ${orgId}`);
  if (RESET) {
    console.log(`Deleted (--reset) :`);
    console.log(`  ${deleted.risk_treatments} risk_treatments, ${deleted.risks} risks, ${deleted.findings} findings`);
    console.log(`  ${deleted.vendors} vendors, ${deleted.ai_systems} ai_systems, ${deleted.controls} controls, ${deleted.obligations} obligations (legacy [STG]-prefixed)`);
  }
  console.log(`Newly inserted    :`);
  console.log(`  ${inserted.findings} findings, ${inserted.risks} risks, ${inserted.risk_treatments} risk_treatments`);
  console.log(`  ${inserted.vendors} vendors, ${inserted.ai_systems} ai_systems, ${inserted.controls} controls, ${inserted.obligations} obligations`);
  console.log(`Total for org now :`);
  console.log(`  ${t.f} [STG] findings, ${t.rk} [STG] risks, ${t.rt} [STG] risk_treatments`);
  console.log(`  ${t.v} vendors, ${t.s} ai_systems, ${t.c} controls, ${t.o} obligations`);

  await pool.end();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
