/**
 * scripts/test-matcher-staging.ts
 *
 * Spot-checks the cyber-signal matcher (cyberSignalProcessingService.processSignal)
 * by submitting 15 synthetic signals against the canonical Staging Inc org and
 * recording what the matcher does for each. Output: a markdown section appended
 * to docs/matcher-spot-check-2026-05-05.md.
 *
 * Usage:
 *   npm run test:matcher-staging
 *
 * Behavior:
 *   1. Refuse to run against prod (current_database != 'securelogic').
 *   2. Find canonical Staging Inc org (most recent of <=4 with that name).
 *   3. Verify seeded inventory (>= 5 vendors, >= 1 ai_system) — exit if missing.
 *   4. INSERT 15 signals with unique dedup_hash (run-scoped) + call processSignal()
 *      directly. Same code path as POST /api/cyber-signals minus HTTP/auth.
 *   5. Categorize each result. Write a markdown section to the spot-check doc.
 *
 * Why direct invocation instead of HTTP:
 *   The route's API path requires API-key auth, entitlement, rate limiter,
 *   and a running local server. Bypassing all of that and calling the same
 *   service the route calls produces equivalent matcher results with much
 *   less setup. Validation/normalization layers are skipped because we own
 *   the input shape — the matcher itself only reads the CyberSignalRecord.
 *
 * Errors are surfaced immediately and the script exits — per spec, the
 * matcher might 500 in ways the audit didn't predict.
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { Pool } from "pg";
import { createHash, randomBytes } from "crypto";
import { writeFileSync, existsSync, appendFileSync } from "fs";
import { resolve } from "path";

import {
  processSignal,
  type CyberSignalRecord
} from "../src/api/lib/cyberSignalProcessingService.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL not set");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ─── Test signal definitions ─────────────────────────────────────────────────

type TestSignal = { vendor: string; group: "brand_hit" | "compound" | "unrelated" };

const TEST_SIGNALS: TestSignal[] = [
  // Brand-only — should match seeded same-name vendors
  { vendor: "Microsoft", group: "brand_hit" },
  { vendor: "Cisco",     group: "brand_hit" },
  { vendor: "Apple",     group: "brand_hit" },
  { vendor: "Adobe",     group: "brand_hit" },
  { vendor: "Apache",    group: "brand_hit" },

  // Compound names — mix of seeded compounds (should hit) and shorthand (should miss)
  { vendor: "Microsoft Azure", group: "compound" },  // seeded: should match
  { vendor: "AWS",             group: "compound" },  // shorthand for Amazon Web Services: should miss
  { vendor: "Bloomberg",       group: "compound" },  // shorthand for Bloomberg Terminal: should miss
  { vendor: "Refinitiv",       group: "compound" },  // shorthand for Refinitiv Eikon: should miss
  { vendor: "Cisco Systems",   group: "compound" },  // seeded: should match

  // Unrelated — no matching inventory, should be no-match
  { vendor: "Oracle",     group: "unrelated" },
  { vendor: "Salesforce", group: "unrelated" },
  { vendor: "Atlassian",  group: "unrelated" },
  { vendor: "GitHub",     group: "unrelated" },
  { vendor: "Snowflake",  group: "unrelated" }
];

// ─── Categorization heuristic ────────────────────────────────────────────────

type CategorizedResult = {
  index: number;
  group: string;
  affected_vendor: string;
  signal_id: string;
  matched_vendor_id: string | null;
  matched_ai_system_id: string | null;
  matched_name: string | null;
  finding_id: string | null;
  finding_domain: string | null;
  category:
    | "clearly correct"
    | "plausible (false positive)"
    | "missed (plausible)"
    | "missed (no inventory overlap)";
  notes: string;
};

function categorize(
  affected_vendor: string,
  matched_name: string | null,
  inventory_names: string[]
): { category: CategorizedResult["category"]; notes: string } {
  if (matched_name !== null) {
    if (matched_name.toLowerCase() === affected_vendor.toLowerCase()) {
      return { category: "clearly correct", notes: "" };
    }
    return {
      category: "plausible (false positive)",
      notes: `signal vendor "${affected_vendor}" → matched entity "${matched_name}" (names differ)`
    };
  }

  // No match — check whether inventory had a substring overlap (suggests a near-miss
  // the matcher would have caught with wildcards or fuzzy logic).
  const sigLower = affected_vendor.toLowerCase();
  const overlapping = inventory_names.filter((n) => {
    const nLower = n.toLowerCase();
    return nLower.includes(sigLower) || sigLower.includes(nLower);
  });

  if (overlapping.length > 0) {
    return {
      category: "missed (plausible)",
      notes: `inventory contains: ${overlapping.map((n) => `"${n}"`).join(", ")}`
    };
  }

  return { category: "missed (no inventory overlap)", notes: "" };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("SecureLogic matcher spot-check");

  // 1. Prod guard
  const dbResult = await pool.query<{ db: string }>("SELECT current_database() AS db");
  const dbName = dbResult.rows[0]?.db;
  if (dbName === "securelogic") {
    console.error(`ERROR: refusing to run against prod (current_database='${dbName}')`);
    await pool.end();
    process.exit(1);
  }
  if (!dbName) {
    console.error("ERROR: could not determine current_database");
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
    console.error(`ERROR: expected 1-4 'Staging Inc' orgs, found ${orgCount}`);
    await pool.end();
    process.exit(1);
  }
  const orgId = orgRows.rows[0]!.id;
  console.log(`  ✓ org: ${orgId} (most recent of ${orgCount})`);

  // 3. Verify seeded inventory
  const invResult = await pool.query<{ vendors: string; ai_systems: string }>(
    `SELECT
       (SELECT COUNT(*)::text FROM vendors    WHERE organization_id = $1 AND status = 'active') AS vendors,
       (SELECT COUNT(*)::text FROM ai_systems WHERE organization_id = $1)                       AS ai_systems`,
    [orgId]
  );
  const vendorCount = parseInt(invResult.rows[0]!.vendors, 10);
  const aiCount = parseInt(invResult.rows[0]!.ai_systems, 10);
  if (vendorCount < 5 || aiCount < 1) {
    console.error(
      `ERROR: insufficient seeded inventory (need >= 5 vendors and >= 1 ai_system; found ${vendorCount} vendors, ${aiCount} ai_systems)`
    );
    console.error("Run: npm run seed:staging -- --reset");
    await pool.end();
    process.exit(1);
  }
  console.log(`  ✓ inventory: ${vendorCount} vendors, ${aiCount} ai_systems`);

  // Snapshot inventory names for categorization (active vendors + all ai_systems).
  const vendorListResult = await pool.query<{ name: string }>(
    `SELECT name FROM vendors WHERE organization_id = $1 AND status = 'active'`,
    [orgId]
  );
  const aiListResult = await pool.query<{ name: string }>(
    `SELECT name FROM ai_systems WHERE organization_id = $1`,
    [orgId]
  );
  const inventoryNames: string[] = [
    ...vendorListResult.rows.map((r) => r.name),
    ...aiListResult.rows.map((r) => r.name)
  ];

  // 4. POST 15 signals via direct INSERT + processSignal()
  const runId = randomBytes(4).toString("hex");
  const startTime = new Date();
  console.log(`\n→ Submitting ${TEST_SIGNALS.length} signals (runId=${runId}) ...`);

  const results: CategorizedResult[] = [];

  for (let i = 0; i < TEST_SIGNALS.length; i++) {
    const ts = TEST_SIGNALS[i]!;

    // Build a unique dedup_hash so re-runs of this script don't collide.
    const dedup_hash = createHash("sha256")
      .update(`spot-check|${runId}|cve|${ts.vendor.toLowerCase()}`)
      .digest("hex");

    const summary = `[spot-check ${runId}] vulnerability advisory affecting ${ts.vendor}`;

    // INSERT signal — bypassing the route's encryptField so we don't need the
    // encryption key. raw_payload = '{}' is the table default; later API
    // consumers should ignore these spot-check rows or the operator can wipe
    // them after review.
    let signalId: string;
    try {
      const insertResult = await pool.query<{ id: string }>(
        `INSERT INTO cyber_signals (
           organization_id, source, signal_type, severity,
           normalized_summary, affected_vendor, affected_cve,
           dedup_hash, ingestion_timestamp, processed
         )
         VALUES ($1, 'manual', 'cve', 'High', $2, $3, NULL, $4, NOW(), FALSE)
         RETURNING id`,
        [orgId, summary, ts.vendor, dedup_hash]
      );
      signalId = insertResult.rows[0]!.id;
    } catch (err) {
      console.error(`\nERROR inserting signal #${i + 1} (vendor='${ts.vendor}'):`, err);
      await pool.end();
      process.exit(1);
    }

    // Call processSignal — the matcher under test.
    const signalRecord: CyberSignalRecord = {
      id: signalId,
      organization_id: orgId,
      source: "manual",
      signal_type: "cve",
      severity: "High",
      normalized_summary: summary,
      affected_vendor: ts.vendor,
      affected_cve: null
    };

    let matchResult;
    try {
      matchResult = await processSignal(signalRecord);
    } catch (err) {
      console.error(
        `\nERROR in processSignal #${i + 1} (vendor='${ts.vendor}', signal_id=${signalId}):`,
        err
      );
      await pool.end();
      process.exit(1);
    }

    const matchedId = matchResult.matched_vendor_id ?? matchResult.matched_ai_system_id;
    const matchHit = matchedId !== null;
    process.stdout.write(
      `  [${(i + 1).toString().padStart(2)}/15] ${ts.vendor.padEnd(22)} → ${matchHit ? "MATCH" : "no match"}\n`
    );

    results.push({
      index: i + 1,
      group: ts.group,
      affected_vendor: ts.vendor,
      signal_id: signalId,
      matched_vendor_id: matchResult.matched_vendor_id,
      matched_ai_system_id: matchResult.matched_ai_system_id,
      matched_name: null, // filled in below after lookup
      finding_id: matchResult.finding ? (matchResult.finding.id as string) : null,
      finding_domain: matchResult.finding ? (matchResult.finding.domain as string) : null,
      category: "missed (no inventory overlap)", // placeholder, filled below
      notes: ""
    });
  }

  // 5. Resolve matched entity names + apply categorization
  const matchedVendorIds = results
    .map((r) => r.matched_vendor_id)
    .filter((id): id is string => id !== null);
  const matchedAiIds = results
    .map((r) => r.matched_ai_system_id)
    .filter((id): id is string => id !== null);

  const vendorsById = new Map<string, string>();
  if (matchedVendorIds.length > 0) {
    const r = await pool.query<{ id: string; name: string }>(
      `SELECT id, name FROM vendors WHERE id = ANY($1::uuid[])`,
      [matchedVendorIds]
    );
    for (const row of r.rows) vendorsById.set(row.id, row.name);
  }
  const aisById = new Map<string, string>();
  if (matchedAiIds.length > 0) {
    const r = await pool.query<{ id: string; name: string }>(
      `SELECT id, name FROM ai_systems WHERE id = ANY($1::uuid[])`,
      [matchedAiIds]
    );
    for (const row of r.rows) aisById.set(row.id, row.name);
  }

  for (const r of results) {
    if (r.matched_vendor_id) r.matched_name = vendorsById.get(r.matched_vendor_id) ?? null;
    else if (r.matched_ai_system_id) r.matched_name = aisById.get(r.matched_ai_system_id) ?? null;

    const cat = categorize(r.affected_vendor, r.matched_name, inventoryNames);
    r.category = cat.category;
    r.notes = cat.notes;
  }

  // 6. Findings sanity-check (independent of matcher's own return value)
  const findingsResult = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM findings
      WHERE organization_id = $1
        AND source_type = 'cyber_signal'
        AND created_at >= $2`,
    [orgId, startTime]
  );
  const findingCount = parseInt(findingsResult.rows[0]!.count, 10);

  // 7. Write markdown section
  const docPath = resolve("docs/matcher-spot-check-2026-05-05.md");
  const ts = new Date().toISOString();
  let md = "";
  if (!existsSync(docPath)) {
    md += `# Auto-matcher spot-check (2026-05-05)\n\n`;
    md += `Direct-invocation tests of \`processSignal()\` against the canonical Staging Inc org.\n`;
    md += `Each run posts 15 synthetic signals and records what the matcher did. Run script:\n\n`;
    md += `\`\`\`\nnpm run test:matcher-staging\n\`\`\`\n\n`;
    md += `Categories applied automatically:\n`;
    md += `- **clearly correct** — matcher matched and the entity name equals the signal vendor (case-insensitive)\n`;
    md += `- **plausible (false positive)** — matcher matched but names differ (unreachable with current ILIKE-equality matcher; included for completeness)\n`;
    md += `- **missed (plausible)** — matcher did not match, but inventory contains a vendor name with substring overlap to the signal vendor (potential near-miss the matcher would catch with wildcards or fuzzy logic)\n`;
    md += `- **missed (no inventory overlap)** — matcher did not match and no inventory vendor has substring overlap (correct outcome for vendors not in inventory)\n\n`;
    md += `---\n\n`;
  }
  md += `## Run ${ts} (runId=\`${runId}\`)\n\n`;
  md += `**Org:** \`${orgId}\`  \n`;
  md += `**Inventory:** ${vendorCount} vendors, ${aiCount} ai_systems  \n`;
  md += `**Signals submitted:** ${TEST_SIGNALS.length}  \n`;
  md += `**Findings created (independent count via DB):** ${findingCount}  \n\n`;

  md += `| # | group | affected_vendor | matched | matched_name | finding_id | domain | category | notes |\n`;
  md += `|---|---|---|---|---|---|---|---|---|\n`;
  for (const r of results) {
    const matched = r.matched_vendor_id || r.matched_ai_system_id ? "yes" : "no";
    const findingShort = r.finding_id ? r.finding_id.slice(0, 8) : "—";
    md += `| ${r.index} | ${r.group} | ${r.affected_vendor} | ${matched} | ${r.matched_name ?? "—"} | ${findingShort} | ${r.finding_domain ?? "—"} | ${r.category} | ${r.notes || "—"} |\n`;
  }

  // Summary counts
  const counts: Record<string, number> = {};
  for (const r of results) counts[r.category] = (counts[r.category] ?? 0) + 1;
  md += `\n**Summary:**\n`;
  for (const [cat, n] of Object.entries(counts).sort()) {
    md += `- ${cat}: **${n}**\n`;
  }
  md += `\n---\n\n`;

  if (existsSync(docPath)) {
    appendFileSync(docPath, md);
  } else {
    writeFileSync(docPath, md);
  }

  console.log(`\n=== Spot-check complete ===`);
  console.log(`Org id            : ${orgId}`);
  console.log(`Signals submitted : ${TEST_SIGNALS.length}`);
  console.log(`Findings created  : ${findingCount}`);
  console.log(`Categories        :`);
  for (const [cat, n] of Object.entries(counts).sort()) {
    console.log(`  ${cat.padEnd(35)}: ${n}`);
  }
  console.log(`Results written to: ${docPath}`);

  await pool.end();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
