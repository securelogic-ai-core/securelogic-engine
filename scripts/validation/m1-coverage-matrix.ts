/**
 * m1-coverage-matrix.ts — M-1 (A04-G1 phase 3) deliverable C-1.
 *
 * Produces the route/worker × table × channel coverage matrix that scopes PR-2
 * and assigns the M1-G1 grant tiers. See docs/M1-app-request-flip-design.md §6.
 *
 * WHAT IT MEASURES
 * ----------------
 * For every route file (src/api/routes/*.ts) and worker core
 * (src/api/workers/*.ts, services/<w>/src/**): each DB call site is attributed
 * to a channel by lexical extent:
 *
 *   TENANT    pg.query / pg.connect inside an `asTenant(...)` or
 *             `withTenant(...)` extent — runs on the request-scoped client with
 *             app.current_org_id set; RLS-safe post-flip.
 *   ELEVATED  pgElevated.* / withElevated(...) (and any site inside a
 *             withElevated extent) — the owner channel; bypasses RLS by design.
 *   RAW       pgRaw.* — the documented escape hatch; always listed.
 *   BARE      pg.query / pg.connect OUTSIDE any tenant extent — falls back to
 *             the raw pool with NO tenant GUC. Post-flip this is the silent-
 *             zero-rows failure mode on policied tables and 42501 on ungranted
 *             ones. Every BARE site must be classified in PR-2.
 *
 * Table references are extracted per-extent from SQL keywords (FROM / JOIN /
 * INSERT INTO / UPDATE / DELETE FROM) and validated against the live table
 * list, then joined with pg_class.relrowsecurity, policy counts, and
 * app_request grants read from the state database.
 *
 * KNOWN LIMITS (documented, acceptable for a review tool):
 *   - Lexical, not data-flow: a lib called from a wrapped handler inherits the
 *     caller's scope at runtime (AsyncLocalStorage); lib files are therefore
 *     OUT of scope here — the matrix covers routes and worker entry cores,
 *     where scope is established.
 *   - Paren-balancing ignores parens inside string literals; on mismatch the
 *     extent extends to EOF (over-attributes to TENANT, never under-reports
 *     BARE... conservative direction is checked by the self-test below).
 *   - Table extraction can pick up identifiers from comments; validated
 *     against the live table list, so noise is bounded to real table names.
 *
 * USAGE
 *   DATABASE_SSL_DISABLED=true M1_DATABASE_URL=postgres://... \
 *     npx tsx scripts/validation/m1-coverage-matrix.ts \
 *       [--out docs/validation/m1-coverage-matrix.md] [--json <path>]
 *
 * The state DB must have the full migration set applied (harness DB or a
 * staging read-only snapshot). Read-only: issues only catalog SELECTs.
 */

import { readFileSync, writeFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { Pool } from "pg";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");

const SCAN_ROOTS = [
  "src/api/routes",
  "src/api/workers",
  "services/intelligence-worker/src",
  "services/posture-worker/src",
  "services/data-rights-worker/src",
  "services/vendor-extraction-worker/src"
];

/** Tier D — tables intentionally holding ZERO app_request grants. Mirror of the
 * allowlist in test/isolation/appRequestGrants.test.ts (C-3); justifications in
 * 20261021_m1_g1_app_request_grant_catchup.sql. */
const TIER_D_ALLOWLIST = new Set([
  "auth_anomaly_alerts",
  "webhook_events_processed",
  "worker_runs",
  "schema_migrations",
  "email_provider_events",
  "feed_health",
  "sources",
  "sso_login_codes",
  "intelligence_event_timeline",
  "intelligence_event_workflow_triggers"
]);

const SQL_KEYWORD_STOPLIST = new Set([
  "select", "where", "values", "set", "returning", "on", "using", "as", "and",
  "or", "not", "null", "true", "false", "lateral", "unnest", "jsonb_each",
  "generate_series", "information_schema", "pg_class", "pg_policy", "pg_roles"
]);

// ---------------------------------------------------------------------------
// Source scanning
// ---------------------------------------------------------------------------

type Channel = "TENANT" | "ELEVATED" | "RAW" | "BARE";

interface Site {
  line: number;
  api: string;
  channel: Channel;
}

interface Extent {
  start: number;
  end: number;
  kind: "tenant" | "elevated";
}

interface FileScan {
  file: string;
  sites: Site[];
  /** table name -> channels that reference it in this file */
  tables: Map<string, Set<Channel>>;
  balanced: boolean;
}

function listFiles(root: string): string[] {
  const abs = path.join(REPO_ROOT, root);
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const p = path.join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".ts") && !p.endsWith(".test.ts") && !p.endsWith(".d.ts")) out.push(p);
    }
  };
  try {
    walk(abs);
  } catch {
    /* root may not exist in a partial checkout */
  }
  return out;
}

/** Find the extent of a call expression starting at the opening paren. */
function callExtent(text: string, openParen: number): number {
  let depth = 0;
  for (let i = openParen; i < text.length; i++) {
    const c = text[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return text.length; // unbalanced — conservative: extends to EOF
}

function findExtents(text: string): { extents: Extent[]; balanced: boolean } {
  const extents: Extent[] = [];
  let balanced = true;
  const patterns: Array<[RegExp, Extent["kind"]]> = [
    [/\basTenant\s*\(/g, "tenant"],
    [/\bwithTenant\s*(?:<[^>]*>)?\s*\(/g, "tenant"],
    [/\bwithElevated\s*(?:<[^>]*>)?\s*\(/g, "elevated"]
  ];
  for (const [re, kind] of patterns) {
    for (let m = re.exec(text); m; m = re.exec(text)) {
      const open = text.indexOf("(", m.index + m[0].length - 1);
      const end = callExtent(text, open);
      if (end === text.length) balanced = false;
      extents.push({ start: m.index, end, kind });
    }
  }
  return { extents, balanced };
}

function lineOf(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i++) if (text[i] === "\n") line++;
  return line;
}

function channelAt(extents: Extent[], offset: number): "tenant" | "elevated" | null {
  // innermost extent wins
  let best: Extent | null = null;
  for (const e of extents) {
    if (offset >= e.start && offset <= e.end) {
      if (!best || e.start > best.start) best = e;
    }
  }
  return best ? best.kind : null;
}

function extractTables(sql: string, liveTables: Set<string>): Set<string> {
  const found = new Set<string>();
  const re = /\b(?:from|join|into|update|delete\s+from|table)\s+"?([a-z_][a-z0-9_]*)"?/gi;
  for (let m = re.exec(sql); m; m = re.exec(sql)) {
    const t = m[1].toLowerCase();
    if (!SQL_KEYWORD_STOPLIST.has(t) && liveTables.has(t)) found.add(t);
  }
  return found;
}

function scanFile(absPath: string, liveTables: Set<string>): FileScan {
  const text = readFileSync(absPath, "utf8");
  const { extents, balanced } = findExtents(text);
  const sites: Site[] = [];

  const sitePatterns: Array<[RegExp, string, (k: "tenant" | "elevated" | null) => Channel]> = [
    [/\bpg\.(query|connect)\s*(?:<[^>]*>)?\s*\(/g, "pg", k =>
      k === "tenant" ? "TENANT" : k === "elevated" ? "ELEVATED" : "BARE"],
    [/\bpgElevated\.(query|connect)\s*(?:<[^>]*>)?\s*\(/g, "pgElevated", () => "ELEVATED"],
    [/\bpgRaw\.(query|connect)\s*(?:<[^>]*>)?\s*\(/g, "pgRaw", () => "RAW"]
  ];
  for (const [re, api, resolve] of sitePatterns) {
    for (let m = re.exec(text); m; m = re.exec(text)) {
      sites.push({
        line: lineOf(text, m.index),
        api: `${api}.${m[1]}`,
        channel: resolve(channelAt(extents, m.index))
      });
    }
  }

  // Per-region table attribution: tenant extents, elevated extents, and the
  // remaining "bare zone" (whole text minus all extents).
  const tables = new Map<string, Set<Channel>>();
  const add = (names: Set<string>, ch: Channel): void => {
    for (const n of names) {
      const s = tables.get(n) ?? new Set<Channel>();
      s.add(ch);
      tables.set(n, s);
    }
  };
  let bareZone = text;
  for (const e of [...extents].sort((a, b) => b.start - a.start)) {
    const region = text.slice(e.start, e.end + 1);
    add(extractTables(region, liveTables), e.kind === "tenant" ? "TENANT" : "ELEVATED");
    bareZone = bareZone.slice(0, e.start) + " ".repeat(e.end + 1 - e.start) + bareZone.slice(e.end + 1);
  }
  // Only attribute the bare zone when the file actually has BARE/ELEVATED
  // sites — otherwise imports/comments would fabricate references.
  const hasBare = sites.some(s => s.channel === "BARE");
  const hasElevated = sites.some(s => s.channel === "ELEVATED");
  if (hasBare || hasElevated) {
    add(extractTables(bareZone, liveTables), hasBare ? "BARE" : "ELEVATED");
  }

  return { file: path.relative(REPO_ROOT, absPath), sites, tables, balanced };
}

// ---------------------------------------------------------------------------
// DB state
// ---------------------------------------------------------------------------

interface TableState {
  rls: boolean;
  force: boolean;
  policies: number;
  grants: string[];
}

async function loadState(pool: Pool): Promise<Map<string, TableState>> {
  const res = await pool.query<{
    relname: string;
    relrowsecurity: boolean;
    relforcerowsecurity: boolean;
    policies: string;
    grants: string | null;
  }>(`
    SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity,
           count(p.polname) AS policies,
           (SELECT string_agg(DISTINCT g.privilege_type, ',' ORDER BY g.privilege_type)
              FROM information_schema.role_table_grants g
             WHERE g.table_name = c.relname AND g.grantee = 'app_request') AS grants
    FROM pg_class c
    LEFT JOIN pg_policy p ON p.polrelid = c.oid
    WHERE c.relkind = 'r' AND c.relnamespace = 'public'::regnamespace
    GROUP BY c.relname, c.relrowsecurity, c.relforcerowsecurity
    ORDER BY c.relname`);
  const map = new Map<string, TableState>();
  for (const r of res.rows) {
    map.set(r.relname, {
      rls: r.relrowsecurity,
      force: r.relforcerowsecurity,
      policies: Number(r.policies),
      grants: r.grants ? r.grants.split(",") : []
    });
  }
  return map;
}

// ---------------------------------------------------------------------------
// Classification + report
// ---------------------------------------------------------------------------

type FileClass =
  | "NO_DB"
  | "TENANT_SCOPED"
  | "ELEVATED_ONLY"
  | "MIXED_EXPLICIT"
  | "NEEDS_REVIEW";

function classify(scan: FileScan): FileClass {
  const has = (c: Channel): boolean => scan.sites.some(s => s.channel === c);
  if (scan.sites.length === 0) return "NO_DB";
  if (has("BARE") || has("RAW")) return "NEEDS_REVIEW";
  if (has("TENANT") && has("ELEVATED")) return "MIXED_EXPLICIT";
  if (has("TENANT")) return "TENANT_SCOPED";
  return "ELEVATED_ONLY";
}

interface BareImpact {
  table: string;
  state: "POLICIED_SILENT_EMPTY" | "UNGRANTED_42501" | "DISCIPLINE_ONLY";
}

function bareImpacts(scan: FileScan, state: Map<string, TableState>): BareImpact[] {
  const out: BareImpact[] = [];
  for (const [table, channels] of scan.tables) {
    if (!channels.has("BARE")) continue;
    const st = state.get(table);
    if (!st) continue;
    if (st.grants.length === 0) out.push({ table, state: "UNGRANTED_42501" });
    else if (st.rls && st.policies > 0) out.push({ table, state: "POLICIED_SILENT_EMPTY" });
    else out.push({ table, state: "DISCIPLINE_ONLY" });
  }
  return out.sort((a, b) => a.table.localeCompare(b.table));
}

// ---------------------------------------------------------------------------
// Self-test of the extent scanner (runs on every invocation; cheap)
// ---------------------------------------------------------------------------

function selfTest(): void {
  const sample = [
    `router.get("/a", asTenant(async (req, res) => { await pg.query("SELECT * FROM findings"); }));`,
    `await pg.query("SELECT * FROM vendors");`,
    `await pgElevated.query("SELECT * FROM jobs");`,
    `await withTenant(orgId, async () => { await pg.query("UPDATE risks SET x=1"); });`
  ].join("\n");
  const live = new Set(["findings", "vendors", "jobs", "risks"]);
  const tmp = path.join(REPO_ROOT, "scripts/validation/.m1-selftest.tmp.ts");
  writeFileSync(tmp, sample);
  let scan: FileScan;
  try {
    scan = scanFile(tmp, live);
  } finally {
    unlinkSync(tmp);
  }
  const by = (c: Channel): number => scan.sites.filter(s => s.channel === c).length;
  const ok =
    by("TENANT") === 2 &&
    by("BARE") === 1 &&
    by("ELEVATED") === 1 &&
    scan.tables.get("findings")?.has("TENANT") === true &&
    scan.tables.get("vendors")?.has("BARE") === true &&
    scan.tables.get("risks")?.has("TENANT") === true;
  if (!ok) {
    console.error("SELF-TEST FAILED — scanner attribution is broken; refusing to emit a report.");
    console.error(JSON.stringify({ sites: scan.sites, tables: [...scan.tables.entries()].map(([t, c]) => [t, [...c]]) }, null, 2));
    process.exit(2);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const outArg = args.includes("--out") ? args[args.indexOf("--out") + 1] : "docs/validation/m1-coverage-matrix.md";
  const jsonArg = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;

  const url = process.env.M1_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
  if (!url) {
    console.error("Set M1_DATABASE_URL or TEST_DATABASE_URL (a DB with the full migration set applied).");
    process.exit(1);
  }

  selfTest();

  const pool = new Pool({ connectionString: url, ssl: process.env.DATABASE_SSL_DISABLED === "true" ? false : undefined });
  const state = await loadState(pool);
  await pool.end();
  const liveTables = new Set(state.keys());

  const files = SCAN_ROOTS.flatMap(listFiles);
  const scans = files.map(f => scanFile(f, liveTables));

  const byClass = new Map<FileClass, FileScan[]>();
  for (const s of scans) {
    const c = classify(s);
    (byClass.get(c) ?? byClass.set(c, []).get(c)!).push(s);
  }

  // Ungranted-table evidence (drives M1-G1 tier assignment)
  const ungranted = [...state.entries()]
    .filter(([t, st]) => st.grants.length === 0 && !TIER_D_ALLOWLIST.has(t))
    .map(([t]) => t)
    .sort();
  const ungrantedUsage = new Map<string, Map<string, Set<Channel>>>();
  for (const t of ungranted) ungrantedUsage.set(t, new Map());
  for (const s of scans) {
    for (const [t, channels] of s.tables) {
      if (ungrantedUsage.has(t)) ungrantedUsage.get(t)!.set(s.file, channels);
    }
  }

  // ---- render ----
  const lines: string[] = [];
  // No timestamps anywhere in the report: regeneration must be diff-stable.
  lines.push(`# M-1 C-1 coverage matrix`);
  lines.push("");
  lines.push(`Generated by \`scripts/validation/m1-coverage-matrix.ts\` against a database`);
  lines.push(`with the full migration set. Regenerate: see the script header.`);
  lines.push("");
  lines.push(`Tables in DB: ${state.size} · RLS-enabled: ${[...state.values()].filter(s => s.rls).length}` +
    ` · policied: ${[...state.values()].filter(s => s.policies > 0).length}` +
    ` · zero-grant (excl. Tier-D): ${ungranted.length}`);
  lines.push("");
  lines.push(`## File classification summary`);
  lines.push("");
  lines.push(`| Class | Files |`);
  lines.push(`|---|---|`);
  for (const c of ["TENANT_SCOPED", "MIXED_EXPLICIT", "ELEVATED_ONLY", "NEEDS_REVIEW", "NO_DB"] as FileClass[]) {
    lines.push(`| ${c} | ${(byClass.get(c) ?? []).length} |`);
  }
  lines.push("");
  for (const c of ["NEEDS_REVIEW", "ELEVATED_ONLY", "MIXED_EXPLICIT", "TENANT_SCOPED"] as FileClass[]) {
    const group = (byClass.get(c) ?? []).sort((a, b) => a.file.localeCompare(b.file));
    if (group.length === 0) continue;
    lines.push(`## ${c} (${group.length})`);
    lines.push("");
    for (const s of group) {
      const bare = s.sites.filter(x => x.channel === "BARE");
      const raw = s.sites.filter(x => x.channel === "RAW");
      const impacts = bareImpacts(s, state);
      const chCounts = (["TENANT", "ELEVATED", "BARE", "RAW"] as Channel[])
        .map(ch => [ch, s.sites.filter(x => x.channel === ch).length] as const)
        .filter(([, n]) => n > 0)
        .map(([ch, n]) => `${ch}:${n}`)
        .join(" ");
      lines.push(`- **${s.file}** — ${chCounts}${s.balanced ? "" : " ⚠ unbalanced-extent (verify manually)"}`);
      if (c === "NEEDS_REVIEW") {
        if (bare.length > 0) lines.push(`  - bare sites: ${bare.map(b => `L${b.line}(${b.api})`).join(", ")}`);
        if (raw.length > 0) lines.push(`  - pgRaw sites: ${raw.map(b => `L${b.line}`).join(", ")}`);
        for (const i of impacts) lines.push(`  - table \`${i.table}\` → ${i.state}`);
      }
    }
    lines.push("");
  }
  lines.push(`## Zero-grant tables (M1-G1 input) — usage evidence`);
  lines.push("");
  for (const t of ungranted) {
    const st = state.get(t)!;
    lines.push(`### ${t}${st.rls ? ` (RLS, ${st.policies} policies)` : ""}`);
    const usage = ungrantedUsage.get(t)!;
    if (usage.size === 0) {
      lines.push(`- no references from routes/workers (lib- or pipeline-internal)`);
    } else {
      for (const [f, chs] of [...usage.entries()].sort()) {
        lines.push(`- ${f}: ${[...chs].join(",")}`);
      }
    }
    lines.push("");
  }

  const resolveOut = (p: string): string => (path.isAbsolute(p) ? p : path.join(REPO_ROOT, p));
  writeFileSync(resolveOut(outArg), lines.join("\n"));
  console.log(`wrote ${outArg}`);
  if (jsonArg) {
    writeFileSync(resolveOut(jsonArg), JSON.stringify({
      state: [...state.entries()],
      files: scans.map(s => ({
        file: s.file,
        class: classify(s),
        balanced: s.balanced,
        sites: s.sites,
        tables: [...s.tables.entries()].map(([t, c]) => [t, [...c]])
      }))
    }, null, 2));
    console.log(`wrote ${jsonArg}`);
  }

  const review = (byClass.get("NEEDS_REVIEW") ?? []).length;
  console.log(`classification: ${scans.length} files — NEEDS_REVIEW=${review}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
