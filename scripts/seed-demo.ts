/**
 * scripts/seed-demo.ts
 *
 * Seeds a demo org "Meridian Financial Services" with realistic financial-sector GRC data:
 * 1 org, 2 users, 3 frameworks (copied from source org), 20 controls, 16 control assessments,
 * 12 vendors, 8 vendor assessments, 18 findings, 10 risks, 14 actions, 90 posture snapshots.
 *
 * Usage:
 *   npx tsx scripts/seed-demo.ts            # idempotent: exits early if org exists
 *   npx tsx scripts/seed-demo.ts --reset    # deletes org first, then re-seeds
 *
 * DO NOT run against production without explicit sign-off.
 * This script writes directly to the database — it does not use the API.
 */

import { config } from "dotenv";
// Load env files as fallbacks only — shell-provided env vars (e.g. DATABASE_URL
// passed on the CLI) always win because override is not set.
config({ path: ".env.local" });
config({ path: ".env" });

import { Pool } from "pg";
import argon2 from "argon2";

// ─── Config ───────────────────────────────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL is not set"); process.exit(1); }

const RESET      = process.argv.includes("--reset");
const DEMO_SLUG  = "meridian-financial-services";
const DEMO_PASS  = "Demo1234!";
// Org whose frameworks we copy — must exist in the source DB.
const SRC_ORG_ID = "3124d8a3-34c0-4696-8c91-64ef0d4eeb17";

// SEED_SRC_DATABASE_URL lets you copy frameworks from a different DB (e.g.
// production) when seeding a fresh demo instance. Falls back to DATABASE_URL
// so the script works unchanged when seeding an org on the same DB.
const SEED_SRC_DATABASE_URL = process.env.SEED_SRC_DATABASE_URL ?? DATABASE_URL;

const pool    = new Pool({ connectionString: DATABASE_URL,       ssl: { rejectUnauthorized: false } });
const srcPool = new Pool({ connectionString: SEED_SRC_DATABASE_URL, ssl: { rejectUnauthorized: false } });

function ok(msg: string)   { console.log(`  ✓ ${msg}`); }
function step(msg: string) { console.log(`\n${msg}`); }

function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysAgo(n: number): string { return daysFromNow(-n); }

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  step("SecureLogic Demo Seed — Meridian Financial Services");

  // ── 0. Reset ─────────────────────────────────────────────────────────────────
  if (RESET) {
    const r = await pool.query(`DELETE FROM organizations WHERE slug = $1`, [DEMO_SLUG]);
    ok(`Reset: deleted ${r.rowCount ?? 0} org row(s) (cascade cleared all related data)`);
  }

  // ── 1. Org ────────────────────────────────────────────────────────────────────
  step("Step 1 — Organization");

  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM organizations WHERE slug = $1`, [DEMO_SLUG]
  );
  if ((existing.rowCount ?? 0) > 0) {
    console.log(`  → Org already exists (${existing.rows[0]!.id}). Use --reset to re-seed.`);
    await pool.end();
    return;
  }

  const orgRow = await pool.query<{ id: string }>(
    `INSERT INTO organizations
       (name, slug, plan, status, regulated, handles_pii, safety_critical,
        scale, entitlement_level, max_members, onboarding_completed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW()) RETURNING id`,
    ["Meridian Financial Services", DEMO_SLUG, "premium", "active",
     true, true, false, "Enterprise", "premium", 50]
  );
  const orgId = orgRow.rows[0]!.id;
  ok(`Org created: Meridian Financial Services (${orgId})`);

  // ── 2. Users ──────────────────────────────────────────────────────────────────
  step("Step 2 — Users");

  const pwHash = await argon2.hash(DEMO_PASS);

  const [adminRow, analystRow] = await Promise.all([
    pool.query<{ id: string }>(
      `INSERT INTO users (organization_id, email, name, role, status, password_hash, email_verified)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [orgId, "admin@meridianfinancial.demo", "Sarah Chen", "admin", "active", pwHash, true]
    ),
    pool.query<{ id: string }>(
      `INSERT INTO users (organization_id, email, name, role, status, password_hash, email_verified)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [orgId, "analyst@meridianfinancial.demo", "James Okafor", "member", "active", pwHash, true]
    ),
  ]);
  const adminId   = adminRow.rows[0]!.id;
  const analystId = analystRow.rows[0]!.id;
  ok(`Admin:   admin@meridianfinancial.demo  (${adminId})`);
  ok(`Analyst: analyst@meridianfinancial.demo (${analystId})`);

  // Demo platform api_keys row — carries entitlement_level so the login/me
  // COALESCE has a key-scoped value to read even if future code prefers it
  // over the org-level value. key_hash is a non-auth placeholder.
  await pool.query(
    `INSERT INTO api_keys
       (organization_id, label, key_hash, entitlement_level, status, created_by_user_id)
     VALUES ($1, $2, $3, 'premium', 'active', $4)`,
    [orgId, "Demo Platform Key", `demo-hash-not-for-auth-${orgId}`, adminId]
  );
  ok(`API key row created (entitlement_level=premium)`);

  // ── 3. Frameworks ─────────────────────────────────────────────────────────────
  step("Step 3 — Frameworks (copy from source org)");

  if (!process.env.SEED_SRC_DATABASE_URL) {
    console.log(`  → SEED_SRC_DATABASE_URL not set; framework copy skipped.`);
    console.log(`  → Set it to the source DB URL to copy frameworks and requirements.`);
  }

  // Read from srcPool (may point to a different DB than pool)
  const srcFws = await srcPool.query<{ id: string; name: string; version: string }>(
    `SELECT id, name, version FROM frameworks WHERE organization_id = $1`, [SRC_ORG_ID]
  );

  let totalReqsCopied = 0;
  for (const sf of srcFws.rows) {
    const fwRow = await pool.query<{ id: string }>(
      `INSERT INTO frameworks (organization_id, name, version) VALUES ($1,$2,$3) RETURNING id`,
      [orgId, sf.name, sf.version]
    );
    const newFwId = fwRow.rows[0]!.id;

    const reqs = await srcPool.query<{ reference_id: string; title: string; description: string | null }>(
      `SELECT reference_id, title, description FROM requirements WHERE framework_id = $1`, [sf.id]
    );
    for (const req of reqs.rows) {
      await pool.query(
        `INSERT INTO requirements (framework_id, reference_id, title, description) VALUES ($1,$2,$3,$4)`,
        [newFwId, req.reference_id, req.title, req.description]
      );
    }
    totalReqsCopied += reqs.rows.length;
    ok(`${sf.name} v${sf.version} — ${reqs.rows.length} requirements`);
  }
  ok(`Total: ${srcFws.rows.length} frameworks, ${totalReqsCopied} requirements`);

  // ── 4. Controls (20) ─────────────────────────────────────────────────────────
  step("Step 4 — Controls (20)");

  type CtrlDef = {
    name: string; domain: string; control_family: string;
    control_type: string; testing_frequency: string;
    implementation_status: string; maturity_level: string;
  };
  const CONTROLS: CtrlDef[] = [
    // Access Control (5)
    { name: "MFA Enforcement",                   domain: "Access Control",  control_family: "Identity",    control_type: "preventive",  testing_frequency: "quarterly", implementation_status: "implemented", maturity_level: "managed"    },
    { name: "Privileged Access Management",      domain: "Access Control",  control_family: "Identity",    control_type: "preventive",  testing_frequency: "quarterly", implementation_status: "implemented", maturity_level: "managed"    },
    { name: "Identity Lifecycle Management",     domain: "Access Control",  control_family: "Identity",    control_type: "detective",   testing_frequency: "monthly",   implementation_status: "partial",     maturity_level: "defined"    },
    { name: "Service Account Review",            domain: "Access Control",  control_family: "Identity",    control_type: "detective",   testing_frequency: "quarterly", implementation_status: "partial",     maturity_level: "defined"    },
    { name: "Remote Access Controls",            domain: "Access Control",  control_family: "Identity",    control_type: "preventive",  testing_frequency: "biannual",  implementation_status: "implemented", maturity_level: "managed"    },
    // Vendor Risk (4)
    { name: "Third-Party Security Assessment",   domain: "Vendor Risk",     control_family: "Vendor",      control_type: "detective",   testing_frequency: "annual",    implementation_status: "implemented", maturity_level: "optimizing" },
    { name: "Vendor Contract Review",            domain: "Vendor Risk",     control_family: "Vendor",      control_type: "preventive",  testing_frequency: "annual",    implementation_status: "implemented", maturity_level: "managed"    },
    { name: "Concentration Risk Monitoring",     domain: "Vendor Risk",     control_family: "Vendor",      control_type: "detective",   testing_frequency: "quarterly", implementation_status: "partial",     maturity_level: "defined"    },
    { name: "Vendor SLA Monitoring",             domain: "Vendor Risk",     control_family: "Vendor",      control_type: "detective",   testing_frequency: "monthly",   implementation_status: "partial",     maturity_level: "initial"    },
    // Data Protection (4)
    { name: "Data Classification Policy",        domain: "Data Protection", control_family: "Data",        control_type: "preventive",  testing_frequency: "annual",    implementation_status: "implemented", maturity_level: "managed"    },
    { name: "Encryption at Rest",                domain: "Data Protection", control_family: "Data",        control_type: "preventive",  testing_frequency: "biannual",  implementation_status: "implemented", maturity_level: "managed"    },
    { name: "Encryption in Transit",             domain: "Data Protection", control_family: "Data",        control_type: "preventive",  testing_frequency: "biannual",  implementation_status: "implemented", maturity_level: "managed"    },
    { name: "Data Retention Controls",           domain: "Data Protection", control_family: "Data",        control_type: "preventive",  testing_frequency: "annual",    implementation_status: "partial",     maturity_level: "defined"    },
    // Vulnerability (3)
    { name: "Vulnerability Scanning Program",    domain: "Vulnerability",   control_family: "Operations",  control_type: "detective",   testing_frequency: "monthly",   implementation_status: "implemented", maturity_level: "optimizing" },
    { name: "Patch Management",                  domain: "Vulnerability",   control_family: "Operations",  control_type: "corrective",  testing_frequency: "monthly",   implementation_status: "partial",     maturity_level: "defined"    },
    { name: "Penetration Testing",               domain: "Vulnerability",   control_family: "Operations",  control_type: "detective",   testing_frequency: "annual",    implementation_status: "implemented", maturity_level: "managed"    },
    // Regulatory (2)
    { name: "SOC 2 Compliance Monitoring",       domain: "Regulatory",      control_family: "Compliance",  control_type: "detective",   testing_frequency: "quarterly", implementation_status: "implemented", maturity_level: "managed"    },
    { name: "SEC Cybersecurity Rule Compliance", domain: "Regulatory",      control_family: "Compliance",  control_type: "detective",   testing_frequency: "quarterly", implementation_status: "partial",     maturity_level: "defined"    },
    // AI Governance (2)
    { name: "AI System Risk Assessment",         domain: "AI Governance",   control_family: "AI",          control_type: "detective",   testing_frequency: "biannual",  implementation_status: "partial",     maturity_level: "initial"    },
    { name: "AI Model Access Controls",          domain: "AI Governance",   control_family: "AI",          control_type: "preventive",  testing_frequency: "quarterly", implementation_status: "partial",     maturity_level: "initial"    },
  ];

  const controlIds: string[] = [];
  for (const c of CONTROLS) {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO controls
         (organization_id, name, domain, control_family, control_type,
          testing_frequency, implementation_status, maturity_level, owner_user_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active') RETURNING id`,
      [orgId, c.name, c.domain, c.control_family, c.control_type,
       c.testing_frequency, c.implementation_status, c.maturity_level, adminId]
    );
    controlIds.push(r.rows[0]!.id);
  }
  ok(`${controlIds.length} controls created`);

  // ── 5. Control assessments (16) ───────────────────────────────────────────────
  step("Step 5 — Control assessments (16)");

  type CaDef = { ci: number; status: string; severity: string | null; summary: string; daysAgo: number };
  const CA: CaDef[] = [
    { ci:  0, status: "passed",               severity: null,       summary: "MFA enforced for all users; hardware key exceptions documented.",              daysAgo: 10 },
    { ci:  1, status: "failed",               severity: "High",     summary: "3 privileged accounts lack quarterly access recertification.",                  daysAgo: 15 },
    { ci:  2, status: "remediation_required", severity: "Moderate", summary: "Offboarded user accounts not consistently disabled within 1-business-day SLA.", daysAgo: 12 },
    { ci:  3, status: "failed",               severity: "High",     summary: "14 service accounts have admin-level permissions lacking business justification.",daysAgo: 20 },
    { ci:  4, status: "passed",               severity: null,       summary: "VPN enforced with certificate auth; access logs reviewed quarterly.",            daysAgo:  8 },
    { ci:  5, status: "passed",               severity: null,       summary: "Annual vendor security assessments completed for all critical vendors.",          daysAgo: 30 },
    { ci:  6, status: "remediation_required", severity: "Moderate", summary: "2 vendor contracts missing updated DPA clauses under GDPR Article 28.",          daysAgo: 25 },
    { ci:  7, status: "in_progress",          severity: null,       summary: "Concentration risk review underway; cloud provider analysis 60% complete.",      daysAgo:  5 },
    { ci:  8, status: "failed",               severity: "Moderate", summary: "SLA breach reporting is manual and inconsistently applied across vendors.",       daysAgo: 18 },
    { ci:  9, status: "passed",               severity: null,       summary: "Data classification taxonomy reviewed and aligned to regulatory requirements.",   daysAgo: 14 },
    { ci: 10, status: "passed",               severity: null,       summary: "AES-256 encryption verified for all PII data stores in scope.",                   daysAgo: 14 },
    { ci: 11, status: "remediation_required", severity: "High",     summary: "Legacy internal settlement API using TLS 1.0; upgrade to TLS 1.3 scheduled.",    daysAgo: 22 },
    { ci: 12, status: "in_progress",          severity: null,       summary: "Retention policy update in progress; 3 data classes pending legal review.",       daysAgo:  7 },
    { ci: 13, status: "failed",               severity: "Critical", summary: "3 production systems with CVSS 9.8 CVEs unpatched beyond 30-day SLA.",           daysAgo:  6 },
    { ci: 14, status: "remediation_required", severity: "High",     summary: "OS patch cycle averaging 38 days vs. 30-day SLA requirement.",                   daysAgo: 10 },
    { ci: 15, status: "in_progress",          severity: null,       summary: "Annual penetration test in progress with external security firm.",                daysAgo:  3 },
  ];

  for (const ca of CA) {
    const cid = controlIds[ca.ci];
    if (!cid) continue;
    await pool.query(
      `INSERT INTO control_assessments
         (organization_id, control_id, status, overall_severity, summary, performed_at, reviewer_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [orgId, cid, ca.status, ca.severity, ca.summary, daysAgo(ca.daysAgo), adminId]
    );
  }
  ok(`${CA.length} control assessments created`);

  // ── 6. Vendors (12) ───────────────────────────────────────────────────────────
  step("Step 6 — Vendors (12)");

  type VendorDef = {
    name: string; category: string; criticality: string;
    data_sensitivity: string; access_level: string;
    service_description: string; website: string;
  };
  const VENDORS: VendorDef[] = [
    { name: "Amazon Web Services",   category: "Cloud Infrastructure", criticality: "critical", data_sensitivity: "restricted",   access_level: "admin",      service_description: "Primary cloud infrastructure — compute, storage, networking, data services.", website: "aws.amazon.com"      },
    { name: "Microsoft Azure",       category: "Cloud Infrastructure", criticality: "critical", data_sensitivity: "restricted",   access_level: "admin",      service_description: "Secondary cloud and Microsoft 365 productivity suite.",                       website: "azure.microsoft.com" },
    { name: "Salesforce",            category: "CRM",                  criticality: "high",     data_sensitivity: "confidential", access_level: "read_write", service_description: "CRM platform; stores customer PII, transaction history, and communications.", website: "salesforce.com"      },
    { name: "ServiceNow",            category: "ITSM",                 criticality: "high",     data_sensitivity: "confidential", access_level: "read_write", service_description: "IT service management and enterprise workflow automation.",                    website: "servicenow.com"      },
    { name: "Okta",                  category: "Identity",             criticality: "critical", data_sensitivity: "restricted",   access_level: "admin",      service_description: "Enterprise identity and access management; controls SSO for all systems.",     website: "okta.com"            },
    { name: "CrowdStrike",           category: "Endpoint Security",    criticality: "high",     data_sensitivity: "confidential", access_level: "read_write", service_description: "Endpoint detection and response platform across all managed devices.",         website: "crowdstrike.com"     },
    { name: "Splunk",                category: "SIEM",                 criticality: "high",     data_sensitivity: "confidential", access_level: "read_write", service_description: "Security information and event management; centralised log analysis.",         website: "splunk.com"          },
    { name: "Palantir",              category: "Data Analytics",       criticality: "medium",   data_sensitivity: "confidential", access_level: "read_write", service_description: "Analytical platform for risk data and portfolio analytics.",                    website: "palantir.com"        },
    { name: "Bloomberg Terminal",    category: "Market Data",          criticality: "high",     data_sensitivity: "confidential", access_level: "read_only",  service_description: "Real-time market data, analytics, and trading system integrations.",            website: "bloomberg.com"       },
    { name: "Refinitiv Eikon",       category: "Market Data",          criticality: "medium",   data_sensitivity: "internal",     access_level: "read_only",  service_description: "Financial data and analysis tools for research and compliance teams.",          website: "refinitiv.com"       },
    { name: "DocuSign",              category: "Contract Management",  criticality: "medium",   data_sensitivity: "confidential", access_level: "read_write", service_description: "Electronic signature and agreement cloud for vendor and client contracts.",     website: "docusign.com"        },
    { name: "Zoom",                  category: "Communications",       criticality: "low",      data_sensitivity: "internal",     access_level: "read_write", service_description: "Video conferencing and collaboration platform.",                                 website: "zoom.us"             },
  ];

  const vendorIds: string[] = [];
  for (const v of VENDORS) {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO vendors
         (organization_id, name, category, criticality, data_sensitivity,
          access_level, service_description, website, owner_user_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active') RETURNING id`,
      [orgId, v.name, v.category, v.criticality, v.data_sensitivity,
       v.access_level, v.service_description, v.website, adminId]
    );
    vendorIds.push(r.rows[0]!.id);
  }
  ok(`${vendorIds.length} vendors created`);

  // ── 7. Vendor assessments (8) ─────────────────────────────────────────────────
  step("Step 7 — Vendor assessments (8)");

  // vendorIds indices: 0=AWS, 1=Azure, 2=Salesforce, 3=ServiceNow, 4=Okta,
  //                   5=CrowdStrike, 6=Splunk, 7=Palantir, 8=Bloomberg, 9=Refinitiv
  type VaDef = { vi: number; assessment_type: string; overall_severity: string; summary: string; daysAgo: number };
  const VA: VaDef[] = [
    { vi: 0, assessment_type: "initial_onboarding",    overall_severity: "High",     summary: "IAM policies overly permissive; S3 bucket ACLs need review. Tracked in remediation plan.",          daysAgo:  60 },
    { vi: 1, assessment_type: "periodic_review",       overall_severity: "Moderate", summary: "Azure AD conditional access policies strengthened; legacy auth protocols not yet blocked.",          daysAgo:  45 },
    { vi: 2, assessment_type: "periodic_review",       overall_severity: "High",     summary: "EU customer PII stored in US instance without adequate data residency controls. DPA amendment needed.", daysAgo: 30 },
    { vi: 4, assessment_type: "security_questionnaire",overall_severity: "Critical", summary: "Vendor-confirmed session token vulnerability in Okta SDK v2.x. Patch timeline 30 days.",            daysAgo:  20 },
    { vi: 5, assessment_type: "initial_onboarding",    overall_severity: "Low",      summary: "CrowdStrike SOC 2 Type II report reviewed. No material issues identified.",                          daysAgo:  90 },
    { vi: 6, assessment_type: "periodic_review",       overall_severity: "Moderate", summary: "Log retention policy reviewed; cold storage archival for SEC-required event categories pending.",    daysAgo:  40 },
    { vi: 8, assessment_type: "periodic_review",       overall_severity: "Moderate", summary: "Terminal access limited to authorised users. Annual user access review completed.",                   daysAgo:  35 },
    { vi: 9, assessment_type: "initial_onboarding",    overall_severity: "Low",      summary: "Read-only market data access. No PII exposure. No material issues.",                                  daysAgo: 120 },
  ];

  const vaIds: string[] = [];
  for (const va of VA) {
    const vid = vendorIds[va.vi];
    if (!vid) continue;
    const r = await pool.query<{ id: string }>(
      `INSERT INTO vendor_assessments
         (organization_id, vendor_id, assessment_type, overall_severity,
          status, summary, performed_at, reviewer_id)
       VALUES ($1,$2,$3,$4,'completed',$5,$6,$7) RETURNING id`,
      [orgId, vid, va.assessment_type, va.overall_severity,
       va.summary, daysAgo(va.daysAgo), analystId]
    );
    vaIds.push(r.rows[0]!.id);
  }
  ok(`${vaIds.length} vendor assessments created`);

  // ── 8. Findings (18) ─────────────────────────────────────────────────────────
  step("Step 8 — Findings (18)");

  // vaIds: [0]=AWS, [1]=Azure, [2]=Salesforce, [3]=Okta, [4]=CrowdStrike,
  //        [5]=Splunk, [6]=Bloomberg, [7]=Refinitiv
  // controlIds: [1]=PAM, [2]=Identity Lifecycle, [3]=ServiceAcct,
  //             [11]=Enc-in-Transit, [13]=VulnScan, [14]=Patch

  type FindingDef = {
    title: string; severity: string; domain: string; status: string;
    source_type: string; source_id: string | null;
    description: string; recommendation: string;
    priority: string; likelihood: string; confidence: string;
  };

  const F: FindingDef[] = [
    // Critical (3)
    {
      title: "Unpatched Critical CVEs in Production Systems",
      severity: "Critical", domain: "Vulnerability", status: "open",
      source_type: "control_test", source_id: controlIds[13] ?? null,
      description: "Three production servers running software with CVSS 9.8 vulnerabilities unpatched for 38 days, exceeding the 30-day remediation SLA.",
      recommendation: "Apply vendor patches within 24 hours; isolate affected systems if patches are unavailable.",
      priority: "immediate", likelihood: "very_high", confidence: "high",
    },
    {
      title: "Okta Session Token Vulnerability — Critical",
      severity: "Critical", domain: "Vendor Risk", status: "open",
      source_type: "vendor_review", source_id: vaIds[3] ?? null,
      description: "Vendor-confirmed session fixation vulnerability in Okta SDK version 2.x allowing token hijacking.",
      recommendation: "Upgrade Okta SDK immediately; implement server-side token rotation as interim mitigation.",
      priority: "immediate", likelihood: "high", confidence: "high",
    },
    {
      title: "AWS IAM Wildcard Permissions",
      severity: "Critical", domain: "Access Control", status: "in_progress",
      source_type: "vendor_review", source_id: vaIds[0] ?? null,
      description: "23 IAM roles granted wildcard S3 and EC2 permissions exceeding least-privilege requirements.",
      recommendation: "Apply least-privilege IAM policies; use AWS IAM Access Analyzer to identify excess permissions.",
      priority: "immediate", likelihood: "high", confidence: "high",
    },
    // High (6)
    {
      title: "Privileged Accounts Missing Quarterly Review",
      severity: "High", domain: "Access Control", status: "open",
      source_type: "control_test", source_id: controlIds[1] ?? null,
      description: "3 privileged accounts have not been recertified in over 90 days, violating access recertification policy.",
      recommendation: "Conduct access review immediately; implement automated review reminders in Okta.",
      priority: "near_term", likelihood: "high", confidence: "high",
    },
    {
      title: "Service Accounts with Admin-Level Permissions",
      severity: "High", domain: "Access Control", status: "open",
      source_type: "control_test", source_id: controlIds[3] ?? null,
      description: "14 service accounts carry admin-level permissions with no documented business justification.",
      recommendation: "Remediate to least-privilege; onboard service accounts into PAM governance.",
      priority: "near_term", likelihood: "high", confidence: "high",
    },
    {
      title: "Salesforce EU Data Residency Non-Compliance",
      severity: "High", domain: "Vendor Risk", status: "open",
      source_type: "vendor_review", source_id: vaIds[2] ?? null,
      description: "EU customer PII stored in US Salesforce instance without adequate data residency controls; potential GDPR Article 44 violation.",
      recommendation: "Activate Salesforce Shield and configure EU data residency; amend data processing agreement.",
      priority: "near_term", likelihood: "medium", confidence: "high",
    },
    {
      title: "OS Patch Cycle Exceeds 30-Day SLA",
      severity: "High", domain: "Vulnerability", status: "open",
      source_type: "control_test", source_id: controlIds[14] ?? null,
      description: "Operating system patches averaging 38-day remediation cycle across 12 production hosts, exceeding policy SLA.",
      recommendation: "Accelerate patch cycle; implement automated patch deployment via configuration management tooling.",
      priority: "near_term", likelihood: "high", confidence: "high",
    },
    {
      title: "Legacy TLS 1.0 on Internal Settlement API",
      severity: "High", domain: "Data Protection", status: "in_progress",
      source_type: "control_test", source_id: controlIds[11] ?? null,
      description: "Internal settlement API using deprecated TLS 1.0 protocol; vulnerable to POODLE and BEAST attacks.",
      recommendation: "Upgrade to TLS 1.3; disable TLS 1.0 and 1.1 across all internal and external endpoints.",
      priority: "near_term", likelihood: "medium", confidence: "high",
    },
    {
      title: "Azure AD Legacy Authentication Not Blocked",
      severity: "High", domain: "Access Control", status: "open",
      source_type: "vendor_review", source_id: vaIds[1] ?? null,
      description: "Azure AD conditional access does not block legacy authentication protocols, bypassing MFA enforcement.",
      recommendation: "Create conditional access policy to block all legacy authentication flows.",
      priority: "near_term", likelihood: "high", confidence: "medium",
    },
    // Moderate (6)
    {
      title: "Vendor Contracts Missing GDPR DPA Clauses",
      severity: "Moderate", domain: "Vendor Risk", status: "open",
      source_type: "manual", source_id: null,
      description: "2 vendor contracts lack updated data processing agreements required under GDPR Article 28.",
      recommendation: "Engage legal to update DPA clauses within 45 days; prioritise vendors processing EU PII.",
      priority: "planned", likelihood: "medium", confidence: "medium",
    },
    {
      title: "Identity Offboarding Exceeds 1-Day SLA",
      severity: "Moderate", domain: "Access Control", status: "open",
      source_type: "control_test", source_id: controlIds[2] ?? null,
      description: "Average identity deprovisioning time is 4.2 business days vs. 1-business-day policy SLA.",
      recommendation: "Automate identity lifecycle via Okta Lifecycle Management; integrate with HR system triggers.",
      priority: "planned", likelihood: "medium", confidence: "high",
    },
    {
      title: "Splunk Log Retention Below SEC 17a-4 Requirement",
      severity: "Moderate", domain: "Regulatory", status: "in_progress",
      source_type: "vendor_review", source_id: vaIds[5] ?? null,
      description: "Security event logs retained for 180 days; SEC Rule 17a-4 requires 6-year retention for specific event categories.",
      recommendation: "Configure Splunk cold storage archival for SEC-required event categories.",
      priority: "planned", likelihood: "medium", confidence: "medium",
    },
    {
      title: "AI Systems Lack Formal Risk Assessments",
      severity: "Moderate", domain: "AI Governance", status: "open",
      source_type: "manual", source_id: null,
      description: "3 production AI systems lack documented risk assessments as required by draft AI governance policy.",
      recommendation: "Complete formal risk assessment for each AI system; establish AI system registry.",
      priority: "planned", likelihood: "medium", confidence: "medium",
    },
    {
      title: "SEC 8-K Materiality Escalation Process Undefined",
      severity: "Moderate", domain: "Regulatory", status: "open",
      source_type: "manual", source_id: null,
      description: "No documented escalation procedure for determining material cybersecurity incidents under the SEC cybersecurity disclosure rule.",
      recommendation: "Document and test CFO/CEO escalation process for SEC materiality determination within 4-day window.",
      priority: "planned", likelihood: "low", confidence: "medium",
    },
    {
      title: "Legacy Data Stores Lack Automated Retention Enforcement",
      severity: "Moderate", domain: "Data Protection", status: "open",
      source_type: "manual", source_id: null,
      description: "3 legacy data stores use manual deletion processes that are inconsistently applied.",
      recommendation: "Implement automated retention enforcement; prioritise data stores containing PII.",
      priority: "planned", likelihood: "medium", confidence: "medium",
    },
    // Low (3)
    {
      title: "Vulnerability Scan Coverage Below 100% Target",
      severity: "Low", domain: "Vulnerability", status: "open",
      source_type: "control_test", source_id: controlIds[13] ?? null,
      description: "Current vulnerability scan coverage is 91% vs. 100% target; 12 assets not included in scan scope.",
      recommendation: "Add missing assets to Tenable scan scope; verify completeness of asset inventory.",
      priority: "watch", likelihood: "low", confidence: "medium",
    },
    {
      title: "Bloomberg Terminal Access Review Overdue",
      severity: "Low", domain: "Vendor Risk", status: "open",
      source_type: "manual", source_id: null,
      description: "Annual Bloomberg Terminal user access review is 15 days overdue per vendor access management schedule.",
      recommendation: "Complete access review within 5 business days.",
      priority: "watch", likelihood: "low", confidence: "high",
    },
    {
      title: "Zoom Recording Retention Policy Not Defined",
      severity: "Low", domain: "Data Protection", status: "open",
      source_type: "manual", source_id: null,
      description: "No defined retention policy for Zoom call recordings; creates potential regulatory exposure for recorded client interactions.",
      recommendation: "Define and enforce Zoom recording retention policy; enable auto-delete for recordings beyond retention period.",
      priority: "watch", likelihood: "low", confidence: "medium",
    },
  ];

  const findingIds: string[] = [];
  for (const f of F) {
    const r = await pool.query<{ id: string }>(
      `INSERT INTO findings
         (organization_id, title, severity, domain, status, source_type, source_id,
          description, recommendation, priority, likelihood, confidence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [orgId, f.title, f.severity, f.domain, f.status, f.source_type, f.source_id,
       f.description, f.recommendation, f.priority, f.likelihood, f.confidence]
    );
    findingIds.push(r.rows[0]!.id);
  }
  ok(`${findingIds.length} findings created`);

  // ── 9. Risks (10) ────────────────────────────────────────────────────────────
  step("Step 9 — Risks (10)");

  // Phase 4 of risk-register-inherent-residual-rating: seed all 9 rating
  // fields explicitly. Legacy = residual on every row (mirror of the
  // create form's Path (i) wire pattern); for the NULL-inherent row,
  // legacy still mirrors residual because legacy is NOT NULL in the
  // schema. Distribution per the demo narrative:
  //
  //   7 risks (R1–R7)  inherent > residual — "Meridian's controls working"
  //                                          R7 is the active-treatment
  //                                          variant with both at High.
  //   1 risk  (R8)     inherent > residual, terminal status mitigated.
  //   1 risk  (R9)     inherent = residual — known gap, formally accepted.
  //   1 risk  (R10)    NULL inherent — backfilled-style closed risk.
  //
  // Owners are realistic financial-services-team-style names; due dates
  // span past, near-future, and null. Domains hit Access Management,
  // Vendor Risk, Vulnerability, Regulatory, Data Protection, and
  // AI Governance for table visual variety.
  type RiskDef = {
    title: string;
    description: string;
    domain: string;
    status: string;
    owner: string | null;
    due_date: string | null;
    treatment: string;
    legacy_likelihood: string;
    legacy_impact: string;
    legacy_risk_rating: string;
    inherent_likelihood: string | null;
    inherent_impact: string | null;
    inherent_rating: string | null;
    residual_likelihood: string | null;
    residual_impact: string | null;
    residual_rating: string | null;
  };
  const RISKS: RiskDef[] = [
    {
      title: "Privileged Access Sprawl Across Trading Systems",
      description: "Standing privileged access on core banking and trading systems exceeds least-privilege policy; ageing service accounts retain admin rights.",
      domain: "Access Management", status: "open",
      owner: "Privileged Access Team", due_date: "2026-08-31",
      treatment: "mitigate",
      legacy_likelihood: "likely",       legacy_impact: "High",     legacy_risk_rating: "High",
      inherent_likelihood: "very_likely", inherent_impact: "Critical", inherent_rating: "Critical",
      residual_likelihood: "likely",      residual_impact: "High",     residual_rating: "High"
    },
    {
      title: "Cloud IAM Wildcard Permissions",
      description: "23 IAM roles in the primary cloud account carry wildcard S3/EC2 permissions exceeding documented business need.",
      domain: "Vendor Risk", status: "open",
      owner: "Cloud Platform Lead", due_date: "2026-07-15",
      treatment: "mitigate",
      legacy_likelihood: "possible", legacy_impact: "High",     legacy_risk_rating: "High",
      inherent_likelihood: "likely",   inherent_impact: "Critical", inherent_rating: "Critical",
      residual_likelihood: "possible", residual_impact: "High",     residual_rating: "High"
    },
    {
      title: "Bloomberg Terminal Access Recertification Lapse",
      description: "Annual Bloomberg Terminal access review is overdue; standing user access is not periodically validated against current business need.",
      domain: "Access Management", status: "open",
      owner: "Sarah Liu, CISO", due_date: "2026-06-30",
      treatment: "mitigate",
      legacy_likelihood: "unlikely", legacy_impact: "Low",      legacy_risk_rating: "Low",
      inherent_likelihood: "possible", inherent_impact: "Moderate", inherent_rating: "Moderate",
      residual_likelihood: "unlikely", residual_impact: "Low",      residual_rating: "Low"
    },
    {
      title: "Internal Settlement API Using Legacy TLS 1.0",
      description: "Internal settlement API still negotiates TLS 1.0; vulnerable to POODLE/BEAST. Migration to TLS 1.3 in flight.",
      domain: "Data Protection", status: "open",
      owner: "Engineering Director", due_date: "2026-09-30",
      treatment: "mitigate",
      legacy_likelihood: "unlikely", legacy_impact: "Moderate", legacy_risk_rating: "Moderate",
      inherent_likelihood: "possible", inherent_impact: "High",     inherent_rating: "High",
      residual_likelihood: "unlikely", residual_impact: "Moderate", residual_rating: "Moderate"
    },
    {
      title: "Salesforce EU PII Data Residency Non-Compliance",
      description: "EU customer PII stored in US Salesforce instance without adequate data residency controls; potential GDPR Article 44 exposure.",
      domain: "Regulatory", status: "open",
      owner: "Salesforce Admin Lead", due_date: "2026-12-31",
      treatment: "mitigate",
      legacy_likelihood: "possible", legacy_impact: "Moderate", legacy_risk_rating: "Moderate",
      inherent_likelihood: "likely",   inherent_impact: "High",     inherent_rating: "High",
      residual_likelihood: "possible", residual_impact: "Moderate", residual_rating: "Moderate"
    },
    {
      title: "Critical OS Patch SLA Breach on Production Hosts",
      description: "OS patch cycle averaging 38 days vs. 30-day SLA across 12 production hosts. Patch automation in flight.",
      domain: "Vulnerability", status: "open",
      owner: "Vulnerability Management Lead", due_date: "2026-06-15",
      treatment: "mitigate",
      legacy_likelihood: "likely",     legacy_impact: "Moderate", legacy_risk_rating: "Moderate",
      inherent_likelihood: "very_likely", inherent_impact: "High",   inherent_rating: "High",
      residual_likelihood: "likely",     residual_impact: "Moderate", residual_rating: "Moderate"
    },
    {
      // R7: active risk under treatment — inherent and residual both High
      // because mitigation is in flight but not yet effective.
      title: "Internal Credit Scoring Model Demonstrates Output Bias",
      description: "Internal ML credit-scoring model shows statistically significant disparity in approval rates across protected segments. Bias audit and human-review overlay underway.",
      domain: "AI Governance", status: "open",
      owner: "Chief Risk Officer", due_date: "2026-10-31",
      treatment: "mitigate",
      legacy_likelihood: "likely", legacy_impact: "High", legacy_risk_rating: "High",
      inherent_likelihood: "likely", inherent_impact: "High", inherent_rating: "High",
      residual_likelihood: "likely", residual_impact: "High", residual_rating: "High"
    },
    {
      // R8: terminal mitigated — controls drove residual from
      // very_likely/Critical to rare/Low (controls highly effective).
      title: "Acquired Subsidiary's Identity Stack Migration",
      description: "Identity stack of recently-acquired subsidiary fully migrated into corporate Okta tenant; legacy IDP retired and access reconciled.",
      domain: "Access Management", status: "mitigated",
      owner: "M&A Integration", due_date: "2026-04-30",
      treatment: "mitigate",
      legacy_likelihood: "rare",         legacy_impact: "Low",      legacy_risk_rating: "Low",
      inherent_likelihood: "very_likely", inherent_impact: "Critical", inherent_rating: "Critical",
      residual_likelihood: "rare",        residual_impact: "Low",     residual_rating: "Low"
    },
    {
      // R9: known gap, formally accepted — inherent = residual.
      title: "SEC 8-K Material Incident Disclosure Process Undefined",
      description: "No documented escalation procedure for determining material cybersecurity incidents under the SEC cybersecurity disclosure rule. Tracking under regulatory roadmap; formally accepted pending Q3 governance project.",
      domain: "Regulatory", status: "accepted",
      owner: "General Counsel", due_date: null,
      treatment: "accept",
      legacy_likelihood: "possible", legacy_impact: "High", legacy_risk_rating: "High",
      inherent_likelihood: "possible", inherent_impact: "High", inherent_rating: "High",
      residual_likelihood: "possible", residual_impact: "High", residual_rating: "High"
    },
    {
      // R10: backfilled-style — NULL inherent (we never recorded the
      // pre-controls assessment). Legacy NOT NULL → mirrors residual.
      title: "Closed: Legacy On-Prem Email Decommission",
      description: "Decommissioning of the legacy on-prem email system completed; all mailboxes migrated to cloud and the on-prem MX records removed.",
      domain: "Vulnerability", status: "closed",
      owner: null, due_date: null,
      treatment: "mitigate",
      legacy_likelihood: "rare", legacy_impact: "Low", legacy_risk_rating: "Low",
      inherent_likelihood: null, inherent_impact: null, inherent_rating: null,
      residual_likelihood: "rare", residual_impact: "Low", residual_rating: "Low"
    },
  ];

  const riskIds: string[] = [];
  for (const r of RISKS) {
    const res = await pool.query<{ id: string }>(
      `INSERT INTO risks
         (organization_id, title, description, domain, status, owner, due_date,
          likelihood, impact, risk_rating,
          inherent_likelihood, inherent_impact, inherent_rating,
          residual_likelihood, residual_impact, residual_rating,
          treatment)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       RETURNING id`,
      [
        orgId, r.title, r.description, r.domain, r.status, r.owner, r.due_date,
        r.legacy_likelihood, r.legacy_impact, r.legacy_risk_rating,
        r.inherent_likelihood, r.inherent_impact, r.inherent_rating,
        r.residual_likelihood, r.residual_impact, r.residual_rating,
        r.treatment,
      ]
    );
    riskIds.push(res.rows[0]!.id);
  }
  ok(`${riskIds.length} risks created`);

  // ── 10. Actions (14) ─────────────────────────────────────────────────────────
  step("Step 10 — Actions (14)");

  type ActionDef = {
    title: string; description: string;
    source_type: string; source_id: string | null;
    priority: string; status: string; dueDays: number;
  };
  const ACTIONS: ActionDef[] = [
    { title: "Patch critical CVE systems within 24 hours",                description: "Emergency patch cycle for 3 systems with CVSS 9.8 CVEs; isolate if patch unavailable.",        source_type: "finding", source_id: findingIds[0]  ?? null, priority: "immediate",  status: "in_progress", dueDays:  2 },
    { title: "Upgrade Okta SDK and rotate session tokens",                description: "Deploy interim token rotation; coordinate SDK upgrade timeline with Okta support.",             source_type: "finding", source_id: findingIds[1]  ?? null, priority: "immediate",  status: "in_progress", dueDays:  3 },
    { title: "Remediate AWS IAM wildcard permission policies",            description: "Run IAM Access Analyzer; enforce least-privilege across all 23 offending roles.",               source_type: "finding", source_id: findingIds[2]  ?? null, priority: "immediate",  status: "in_progress", dueDays:  5 },
    { title: "Complete privileged account access recertification",        description: "Review and certify all 3 overdue privileged accounts; document outcomes.",                      source_type: "finding", source_id: findingIds[3]  ?? null, priority: "near_term",  status: "open",        dueDays: 10 },
    { title: "Remediate service accounts to least-privilege",             description: "Document and restrict all 14 admin-level service accounts; implement PAM governance.",          source_type: "finding", source_id: findingIds[4]  ?? null, priority: "near_term",  status: "open",        dueDays: 14 },
    { title: "Activate Salesforce Shield for EU data residency",          description: "Configure Salesforce EU data residency; amend DPA with updated Article 28 clauses.",           source_type: "finding", source_id: findingIds[5]  ?? null, priority: "near_term",  status: "open",        dueDays: 21 },
    { title: "Reduce OS patch cycle to 14-day target",                   description: "Automate OS patching via configuration management; report weekly progress to CISO.",            source_type: "finding", source_id: findingIds[6]  ?? null, priority: "near_term",  status: "open",        dueDays: 14 },
    { title: "Upgrade internal settlement API to TLS 1.3",               description: "Migrate to TLS 1.3; disable TLS 1.0/1.1 across all internal endpoints.",                       source_type: "finding", source_id: findingIds[7]  ?? null, priority: "near_term",  status: "in_progress", dueDays: 30 },
    { title: "Block legacy authentication in Azure AD",                  description: "Deploy conditional access policy blocking all legacy authentication protocols.",                source_type: "finding", source_id: findingIds[8]  ?? null, priority: "near_term",  status: "open",        dueDays: 21 },
    { title: "Update vendor DPA clauses for GDPR Article 28",            description: "Legal review and update of 2 non-compliant vendor contracts; prioritise EU PII processors.",    source_type: "finding", source_id: findingIds[9]  ?? null, priority: "planned",    status: "open",        dueDays: 45 },
    { title: "Configure Splunk cold storage for SEC 17a-4 archival",     description: "Implement 6-year event archival for SEC Rule 17a-4 required event categories.",                 source_type: "finding", source_id: findingIds[11] ?? null, priority: "planned",    status: "open",        dueDays: 60 },
    { title: "Complete formal AI system risk assessments",               description: "Document risk assessment for each of 3 production AI systems; establish AI registry.",          source_type: "manual",  source_id: null,                  priority: "planned",    status: "open",        dueDays: 60 },
    { title: "Document SEC 8-K materiality escalation procedure",        description: "Define CFO/CEO escalation process for material cyber incident SEC disclosure within 4 days.",    source_type: "manual",  source_id: null,                  priority: "planned",    status: "open",        dueDays: 45 },
    { title: "Define Zoom recording retention and auto-delete policy",   description: "Establish retention policy; configure auto-delete for recordings beyond defined period.",        source_type: "finding", source_id: findingIds[17] ?? null, priority: "watch",      status: "open",        dueDays: 90 },
  ];

  for (const a of ACTIONS) {
    await pool.query(
      `INSERT INTO actions
         (organization_id, title, description, source_type, source_id,
          priority, status, due_date, owner_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [orgId, a.title, a.description, a.source_type, a.source_id,
       a.priority, a.status, daysFromNow(a.dueDays), analystId]
    );
  }
  ok(`${ACTIONS.length} actions created`);

  // ── 11. Posture snapshots — 90-day trajectory ─────────────────────────────────
  step("Step 11 — Posture snapshots (90 daily)");

  // Score trajectory: breach discovery → remediation → recovery
  // Day index 0 = 90 days ago, index 89 = today
  function overallScore(i: number): number {
    if (i < 20) return Math.round(32 + (i / 20) * 8);         // 32→40: discovery phase
    if (i < 45) return Math.round(40 + ((i - 20) / 25) * 17); // 40→57: remediation begins
    if (i < 70) return Math.round(57 + ((i - 45) / 25) * 11); // 57→68: active improvement
    // 68→74: near-recovery with minor fluctuation
    const base = Math.round(68 + ((i - 70) / 20) * 6);
    const noise = [0, 1, -1, 0, 2, -2, 1][i % 7] ?? 0;
    return Math.max(0, Math.min(100, base + noise));
  }

  function toSeverity(score: number): string {
    if (score <= 30) return "Critical";
    if (score <= 50) return "High";
    if (score <= 70) return "Moderate";
    return "Low";
  }

  // Per-domain offsets from overall score (persistent characteristics of this org)
  const DOMAIN_OFFSETS: Record<string, number> = {
    "Access Control":  -6,
    "Vendor Risk":     -9,
    "Vulnerability":    3,
    "Regulatory":       6,
    "Data Protection":  2,
  };
  const DOMAINS = Object.keys(DOMAIN_OFFSETS);

  const prevByDomain: Record<string, number> = {};
  let snapshotsCreated = 0;

  for (let i = 0; i < 90; i++) {
    const dateStr = daysAgo(89 - i);
    const overall  = overallScore(i);
    const severity = toSeverity(overall);

    // Simulate finding/action counts gradually declining as remediation progresses
    const openFindings   = Math.max(4, Math.round(18 - (i / 89) * 8));
    const openActions    = Math.max(3, Math.round(14 - (i / 89) * 6));
    const overdueActions = i < 30 ? Math.round(5 * (1 - i / 30)) : 0;

    const snapResult = await pool.query<{ id: string }>(
      `INSERT INTO posture_snapshots
         (organization_id, snapshot_date, overall_score, overall_severity,
          open_finding_count, open_action_count, overdue_action_count, computation_rationale)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (organization_id, snapshot_date) DO NOTHING
       RETURNING id`,
      [
        orgId, dateStr, overall, severity,
        openFindings, openActions, overdueActions,
        JSON.stringify({
          note: `Seed data — snapshot ${i + 1}/90 (${dateStr})`,
          engine: "seed-demo",
          context_applied: { regulated: true, handles_pii: true, safety_critical: false, scale: "Enterprise" },
        }),
      ]
    );
    const snapRow = snapResult.rows[0];
    if (!snapRow) continue; // conflict on re-seed with partial --reset
    const snapId = snapRow.id;
    snapshotsCreated++;

    // Domain scores
    const vals: unknown[] = [];
    const placeholders: string[] = [];
    let p = 1;

    for (const domain of DOMAINS) {
      const offset = DOMAIN_OFFSETS[domain] ?? 0;
      const score  = Math.max(0, Math.min(100, overall + offset));
      const sev    = toSeverity(score);
      const prev   = prevByDomain[domain];
      let trend: string;
      if (prev === undefined) {
        trend = "unknown";
      } else if (score - prev >= 5) {
        trend = "improving";
      } else if (prev - score >= 5) {
        trend = "worsening";
      } else {
        trend = "stable";
      }
      const fc = Math.max(0, Math.round(openFindings / DOMAINS.length + (offset < 0 ? 1 : 0)));

      placeholders.push(`($${p},$${p+1},$${p+2},$${p+3},$${p+4},$${p+5},$${p+6})`);
      vals.push(snapId, domain, score, sev, fc, trend, `${fc} finding(s); score ${score}; trend ${trend}`);
      p += 7;
      prevByDomain[domain] = score;
    }

    await pool.query(
      `INSERT INTO domain_scores
         (posture_snapshot_id, domain, score, severity, finding_count, trend_direction, rationale)
       VALUES ${placeholders.join(",")}`,
      vals
    );
  }
  ok(`${snapshotsCreated} posture snapshots with ${DOMAINS.length} domain scores each`);

  // ── Summary ────────────────────────────────────────────────────────────────────
  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Seed complete — Meridian Financial Services
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Org ID:             ${orgId}
  Slug:               ${DEMO_SLUG}
  Admin:              admin@meridianfinancial.demo
  Analyst:            analyst@meridianfinancial.demo
  Password (both):    ${DEMO_PASS}
  ─────────────────────────────────────────────────────
  Frameworks:         ${srcFws.rows.length} (${totalReqsCopied} requirements)
  Controls:           ${controlIds.length}
  Control assessments:${CA.length}
  Vendors:            ${vendorIds.length}
  Vendor assessments: ${vaIds.length}
  Findings:           ${findingIds.length}
  Risks:              ${riskIds.length}
  Actions:            ${ACTIONS.length}
  Posture snapshots:  ${snapshotsCreated} (90-day trajectory, score 32→74)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);

  await pool.end();
  if (process.env.SEED_SRC_DATABASE_URL) await srcPool.end();
}

main().catch((e: unknown) => {
  console.error("Seed failed:", e);
  process.exit(1);
});
