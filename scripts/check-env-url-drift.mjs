#!/usr/bin/env node
/**
 * check-env-url-drift.mjs — Staging→production URL drift guard (Sprint 3A).
 *
 * Purpose
 * -------
 * The app (`app/`) and marketing site (`website/`) are built per environment.
 * A production host that is hardcoded into client/build code silently ships in
 * the STAGING build too, so a staging deployment points at production (login,
 * brief signup, SSO, CTAs, CSP). This guard fails CI when a production host
 * appears in `app/` or `website/` source as anything other than a documented,
 * environment-overridable fallback.
 *
 * The rule
 * --------
 * A forbidden production host (below) is allowed ONLY when it is the right-hand
 * side of an environment-variable fallback on the same line, e.g.:
 *
 *     process.env.NEXT_PUBLIC_APP_URL ?? "https://app.securelogicai.com"
 *
 * In that form the value is overridden per environment (staging build sets the
 * staging URL) and the literal is just the dev/last-resort default. ANY other
 * occurrence — a bare href, an inlined string, a CSP entry — is drift and fails.
 *
 * This intentionally does NOT forbid the marketing apex (www.securelogicai.com)
 * or plain email addresses (no scheme) — those are environment-independent.
 *
 * Scope: app/ and website/ source. Excludes build output, deps, tests, and
 * .env.example files (which document the prod values on purpose).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

// Production hosts that must never be hardcoded into a staging build.
// (Marketing apex www.securelogicai.com is deliberately omitted — see header.)
export const FORBIDDEN_HOSTS = [
  "app.securelogicai.com",
  "api.securelogicai.com",
  "securelogic-engine.onrender.com",
  "securelogic-app.onrender.com",
];

const SCAN_DIRS = ["app", "website"];
const SOURCE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const SKIP_DIRS = new Set(["node_modules", ".next", "out", "dist", ".turbo", "coverage"]);

function isTestFile(path) {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(path) || path.includes("__tests__");
}

/** A line is OK only if EVERY forbidden-host occurrence on it sits in an
 *  environment-variable fallback — `process.env.NAME ?? "https://<host>"`. Any
 *  bare/standalone occurrence makes the line a violation. */
export function lineIsAllowedFallback(line, host) {
  const h = host.replace(/[.]/g, "\\.");
  const total = (line.match(new RegExp(h, "g")) || []).length;
  const fallbacks = (
    line.match(new RegExp(`process\\.env\\.[A-Za-z0-9_]+\\s*\\?\\?\\s*[\`'"]https?://${h}`, "g")) || []
  ).length;
  return total > 0 && fallbacks >= total;
}

/** Scan the given directories (relative to `root`) and return drift violations. */
export function scan(root = ROOT, dirs = SCAN_DIRS) {
  const violations = [];

  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(entry)) walk(full);
        continue;
      }
      if (!SOURCE_EXT.has(extname(entry))) continue;
      if (isTestFile(full)) continue;

      const rel = relative(root, full);
      const lines = readFileSync(full, "utf8").split("\n");
      lines.forEach((line, i) => {
        for (const host of FORBIDDEN_HOSTS) {
          if (!line.includes(host)) continue;
          if (lineIsAllowedFallback(line, host)) continue;
          violations.push({ file: rel, line: i + 1, host, text: line.trim() });
        }
      });
    }
  }

  for (const d of dirs) {
    const abs = join(root, d);
    try {
      if (statSync(abs).isDirectory()) walk(abs);
    } catch {
      // directory absent in this checkout — skip
    }
  }
  return violations;
}

// Run as a CLI only when invoked directly (so tests can import the functions
// above without triggering a scan or process.exit).
const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  const violations = scan();
  if (violations.length > 0) {
    console.error("\n✖ Staging→production URL drift detected.\n");
    console.error(
      "  A production host is hardcoded in app/ or website/ source. It will ship in\n" +
        "  the STAGING build and route staging traffic to production.\n" +
        '  Allowed form: process.env.NEXT_PUBLIC_X ?? "https://<prod-host>"  (env-overridable).\n'
    );
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line}  [${v.host}]`);
      console.error(`      ${v.text}`);
    }
    console.error(`\n  ${violations.length} violation(s).\n`);
    process.exit(1);
  }

  console.log("✓ No staging→production URL drift in app/ or website/ source.");
}
