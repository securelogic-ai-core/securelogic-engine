/**
 * scripts/seedDemoData.ts
 *
 * Seeds the SecureLogic AI demo dataset for org 51ee8a29.
 * Run with: npx tsx scripts/seedDemoData.ts
 *
 * On any error the step is logged and the script continues.
 */

const API_BASE = "http://localhost:4000";
const API_KEY  = "sl_a335d59064a56e79b457c1ee1be67dca";
const ORG_ID   = "51ee8a29-018e-4f30-9aba-9e0e2ec5dfbb";

// ─── helpers ──────────────────────────────────────────────────────────────────

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": API_KEY,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok)
    throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function ok(msg: string)  { console.log(`  ✓ ${msg}`); }
function err(msg: string) { console.error(`  ✗ ${msg}`); }

// ─── counters ─────────────────────────────────────────────────────────────────

let vendorsCreated       = 0;
let vendorReviewsCreated = 0;
let aiSystemsCreated     = 0;
let obligationsCreated   = 0;
let risksCreated         = 0;
let treatmentsCreated    = 0;
let signalsFetched       = 0;
let briefId: string | null = null;

// ─── STEP 1 — Vendors + reviews ───────────────────────────────────────────────

console.log("\nStep 1 — Vendors");

const VENDOR_DEFS = [
  { name: "Salesforce",  category: "SaaS",                  criticality: "high",     data_sensitivity: "confidential" },
  { name: "AWS",         category: "Cloud Infrastructure",   criticality: "critical",  data_sensitivity: "confidential" },
  { name: "Okta",        category: "Identity",               criticality: "critical",  data_sensitivity: "confidential" },
  { name: "GitHub",      category: "DevTools",               criticality: "medium",    data_sensitivity: "internal"     },
  { name: "Stripe",      category: "Payments",               criticality: "high",      data_sensitivity: "confidential" },
];

// Vendor reviews that should reach a concerning state.
// Map vendor name → { status, overall_severity, notes }
const CONCERNING_REVIEWS: Record<string, { status: string; overall_severity: string; notes: string }> = {
  Salesforce: {
    status: "concerns_identified",
    overall_severity: "Moderate",
    notes: "Data residency concerns identified",
  },
  AWS: {
    status: "critical_issues",
    overall_severity: "Critical",
    notes: "IAM misconfiguration found in audit",
  },
  Okta: {
    status: "concerns_identified",
    overall_severity: "High",
    notes: "MFA bypass vulnerability reported",
  },
};

const vendorIds: Record<string, string> = {};

for (const def of VENDOR_DEFS) {
  try {
    const v = await api("POST", "/api/vendors", def);
    vendorIds[def.name] = v.vendor.id ?? v.id;
    vendorsCreated++;
    ok(`Vendor created: ${def.name} (${vendorIds[def.name]})`);
  } catch (e) {
    err(`Vendor ${def.name}: ${e}`);
    continue;
  }

  const vid = vendorIds[def.name];
  if (!vid) continue;

  // Create review (starts at not_started)
  let reviewId: string | null = null;
  try {
    const r = await api("POST", "/api/vendor-reviews", { vendor_id: vid });
    reviewId = r.vendorReview?.id ?? r.id;
    vendorReviewsCreated++;
    ok(`  Review created for ${def.name} (${reviewId})`);
  } catch (e) {
    err(`  Review create ${def.name}: ${e}`);
  }

  if (!reviewId) continue;

  const concerning = CONCERNING_REVIEWS[def.name];
  if (!concerning) continue; // GitHub + Stripe stay at not_started

  // Transition: not_started → in_progress
  try {
    await api("PATCH", `/api/vendor-reviews/${reviewId}`, { status: "in_progress" });
    ok(`  Review → in_progress: ${def.name}`);
  } catch (e) {
    err(`  Review in_progress ${def.name}: ${e}`);
    continue;
  }

  // Transition: in_progress → concerning state (creates finding)
  try {
    await api("PATCH", `/api/vendor-reviews/${reviewId}`, {
      status:           concerning.status,
      overall_severity: concerning.overall_severity,
      notes:            concerning.notes,
    });
    ok(`  Review → ${concerning.status}: ${def.name}`);
  } catch (e) {
    err(`  Review ${concerning.status} ${def.name}: ${e}`);
  }
}

// ─── STEP 2 — AI systems + governance assessments ─────────────────────────────

console.log("\nStep 2 — AI Systems");

const AI_SYSTEM_DEFS = [
  { name: "GPT-4 Integration",      model_type: "OpenAI GPT-4",      use_case: "Customer support automation",   criticality: "high",   deployment_status: "production" },
  { name: "Internal ML Risk Model",  model_type: "Internal",           use_case: "Risk scoring engine",           criticality: "high",   deployment_status: "production" },
  { name: "Claude API",              model_type: "Anthropic Claude",   use_case: "Intelligence brief generation", criticality: "medium", deployment_status: "production" },
];

const aiSystemIds: string[] = [];

for (const def of AI_SYSTEM_DEFS) {
  let sysId: string | null = null;
  try {
    const s = await api("POST", "/api/ai-systems", def);
    sysId = s.aiSystem?.id ?? s.id;
    aiSystemsCreated++;
    ok(`AI system created: ${def.name} (${sysId})`);
    aiSystemIds.push(sysId!);
  } catch (e) {
    err(`AI system ${def.name}: ${e}`);
    continue;
  }

  if (!sysId) continue;

  try {
    const g = await api("POST", "/api/ai-governance-assessments", { ai_system_id: sysId });
    const gid = g.assessment?.id ?? g.id;
    ok(`  Governance assessment created: ${gid}`);
  } catch (e) {
    err(`  Governance assessment for ${def.name}: ${e}`);
  }
}

// ─── STEP 3 — Obligations + assessments ───────────────────────────────────────

console.log("\nStep 3 — Obligations");

// obligation status (active/waived/not_applicable) is separate from assessment compliance status
const OBLIGATION_DEFS = [
  { title: "SOC 2 Type II", source_regulation: "AICPA SOC 2",    domain: "Regulatory", assessmentStatus: "partially_compliant", overall_severity: "High"     },
  { title: "ISO 27001",     source_regulation: "ISO/IEC 27001",   domain: "Regulatory", assessmentStatus: "non_compliant",       overall_severity: "High"     },
  { title: "GDPR",          source_regulation: "EU GDPR",         domain: "Regulatory", assessmentStatus: "compliant",           overall_severity: null       },
  { title: "HIPAA",         source_regulation: "HIPAA",           domain: "Regulatory", assessmentStatus: "partially_compliant", overall_severity: "Moderate" },
  { title: "NIST CSF",      source_regulation: "NIST CSF 2.0",    domain: "Regulatory", assessmentStatus: "compliant",           overall_severity: null       },
];

for (const def of OBLIGATION_DEFS) {
  let obligationId: string | null = null;
  try {
    const o = await api("POST", "/api/obligations", {
      title:              def.title,
      source_regulation:  def.source_regulation,
      domain:             def.domain,
      status:             "active",
    });
    obligationId = o.obligation?.id ?? o.id;
    obligationsCreated++;
    ok(`Obligation created: ${def.title} (${obligationId})`);
  } catch (e) {
    err(`Obligation ${def.title}: ${e}`);
    continue;
  }

  if (!obligationId) continue;

  // Create assessment (starts at not_started)
  let assessmentId: string | null = null;
  try {
    const a = await api("POST", "/api/obligation-assessments", { obligation_id: obligationId });
    assessmentId = a.assessment?.id ?? a.id;
    ok(`  Assessment created for ${def.title} (${assessmentId})`);
  } catch (e) {
    err(`  Assessment create ${def.title}: ${e}`);
    continue;
  }

  if (!assessmentId) continue;

  // Transition: not_started → in_progress
  try {
    await api("PATCH", `/api/obligation-assessments/${assessmentId}`, { status: "in_progress" });
    ok(`  Assessment → in_progress: ${def.title}`);
  } catch (e) {
    err(`  Assessment in_progress ${def.title}: ${e}`);
    continue;
  }

  // Transition: in_progress → target status
  const patchBody: Record<string, unknown> = { status: def.assessmentStatus };
  if (def.overall_severity) patchBody.overall_severity = def.overall_severity;

  try {
    await api("PATCH", `/api/obligation-assessments/${assessmentId}`, patchBody);
    ok(`  Assessment → ${def.assessmentStatus}: ${def.title}`);
  } catch (e) {
    err(`  Assessment ${def.assessmentStatus} ${def.title}: ${e}`);
  }
}

// ─── STEP 4 — Risks + treatments ──────────────────────────────────────────────

console.log("\nStep 4 — Risks");

const RISK_DEFS = [
  {
    title:       "Third-party data breach via Salesforce integration",
    domain:      "Vendor Risk",
    likelihood:  "likely",
    impact:      "Critical",
    risk_rating: "Critical",
  },
  {
    title:       "AWS IAM privilege escalation",
    domain:      "Vendor Risk",
    likelihood:  "possible",
    impact:      "Critical",
    risk_rating: "High",
  },
  {
    title:       "GPT-4 data leakage in customer support",
    domain:      "AI Governance",
    likelihood:  "possible",
    impact:      "High",
    risk_rating: "High",
  },
  {
    title:       "SOC 2 audit failure risk",
    domain:      "Regulatory",
    likelihood:  "possible",
    impact:      "Moderate",
    risk_rating: "Moderate",
  },
  {
    title:       "CISA KEV vulnerability in production stack",
    domain:      "Vulnerability",
    likelihood:  "likely",
    impact:      "Critical",
    risk_rating: "Critical",
  },
  {
    title:       "Okta session token theft",
    domain:      "Vendor Risk",
    likelihood:  "unlikely",
    impact:      "High",
    risk_rating: "High",
  },
];

const riskIds: string[] = [];

for (const def of RISK_DEFS) {
  try {
    const r = await api("POST", "/api/risks", def);
    const rid = r.risk?.id ?? r.id;
    riskIds.push(rid);
    risksCreated++;
    ok(`Risk created: ${def.title} (${rid})`);
  } catch (e) {
    err(`Risk "${def.title}": ${e}`);
    riskIds.push(""); // keep index alignment
  }
}

// Treatments for first 3 risks
console.log("\n  Risk treatments (first 3)");

const TREATMENT_DEFS = [
  { summary: "Enforce DPA with Salesforce, enable audit logging, quarterly review",  treatment_type: "mitigate" },
  { summary: "Remediate IAM policies, enforce least-privilege, enable CloudTrail",    treatment_type: "mitigate" },
  { summary: "Implement PII redaction layer, restrict sensitive data to GPT-4 input", treatment_type: "mitigate" },
];

for (let i = 0; i < 3; i++) {
  const rid = riskIds[i];
  if (!rid) continue;

  let treatId: string | null = null;
  try {
    const t = await api("POST", "/api/risk-treatments", {
      risk_id:        rid,
      treatment_type: TREATMENT_DEFS[i].treatment_type,
      summary:        TREATMENT_DEFS[i].summary,
    });
    treatId = t.treatment?.id ?? t.id;
    treatmentsCreated++;
    ok(`Treatment created for risk ${i + 1} (${treatId})`);
  } catch (e) {
    err(`Treatment create risk ${i + 1}: ${e}`);
    continue;
  }

  if (!treatId) continue;

  // Transition: not_started → in_progress
  try {
    await api("PATCH", `/api/risk-treatments/${treatId}`, { status: "in_progress" });
    ok(`  Treatment → in_progress`);
  } catch (e) {
    err(`  Treatment in_progress: ${e}`);
  }
}

// ─── STEP 5 — Posture snapshot ────────────────────────────────────────────────

console.log("\nStep 5 — Posture snapshot");

try {
  await api("POST", "/api/posture/snapshot");
  ok("Posture snapshot triggered");
} catch (e) {
  err(`Posture snapshot: ${e}`);
}

// ─── STEP 6 — Signals ─────────────────────────────────────────────────────────

console.log("\nStep 6 — Signals (this may be slow)");

const SIGNAL_FEEDS = [
  "/api/cyber-signals/fetch/cisa-kev",
  "/api/cyber-signals/fetch/cisa-alerts",
  "/api/cyber-signals/fetch/regulatory",
];

for (const feed of SIGNAL_FEEDS) {
  try {
    console.log(`  → Fetching ${feed} ...`);
    const r = await api("POST", feed);
    const inserted = r.inserted ?? r.fetched ?? "?";
    signalsFetched += typeof inserted === "number" ? inserted : 0;
    ok(`${feed}: inserted=${inserted}`);
  } catch (e) {
    err(`${feed}: ${e}`);
  }
  await sleep(5000);
}

// ─── STEP 7 — Intelligence brief ──────────────────────────────────────────────

console.log("\nStep 7 — Intelligence brief");

try {
  const b = await api("POST", "/api/intelligence-briefs/generate");
  briefId = b.brief?.id ?? b.id ?? null;
  ok(`Brief generated: ${briefId}`);
} catch (e) {
  err(`Brief generate: ${e}`);
}

// ─── STEP 8 — Count findings ──────────────────────────────────────────────────

let findingsCount = 0;
try {
  const f = await api("GET", "/api/findings?limit=100");
  findingsCount = f.findings?.length ?? f.total ?? 0;
} catch (e) {
  err(`Findings fetch: ${e}`);
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Seed complete — org ${ORG_ID}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ✓ Vendors created:          ${vendorsCreated}
  ✓ Vendor reviews created:   ${vendorReviewsCreated}
  ✓ Findings generated:       ${findingsCount}
  ✓ AI systems created:       ${aiSystemsCreated}
  ✓ Obligations created:      ${obligationsCreated}
  ✓ Risks created:            ${risksCreated}
  ✓ Risk treatments created:  ${treatmentsCreated}
  ✓ Posture snapshot:         done
  ✓ Signals fetched:          ${signalsFetched}
  ✓ Brief generated:          ${briefId ?? "skipped (check ANTHROPIC_API_KEY)"}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
