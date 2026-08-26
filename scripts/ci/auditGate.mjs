/**
 * auditGate.mjs — the CI dependency-audit gate (dependency-remediation package,
 * 2026-08-17). Replaces the bare `npm audit --audit-level=high` step that had
 * been red for weeks and taught everyone to ignore it.
 *
 * CONTRACT
 * --------
 * FAILS (exit 1) when any HIGH or CRITICAL advisory exists in PRODUCTION
 * dependencies (`npm audit --omit=dev`) that is not covered by a valid waiver.
 *
 * A waiver lives in `.audit-waivers.json` at the repo root:
 *
 *   { "waivers": [ { "id": "GHSA-xxxx-xxxx-xxxx",
 *                    "reason": "why this is acceptable + the triage link",
 *                    "expires": "YYYY-MM-DD",
 *                    "approvedBy": "operator" } ] }
 *
 * Waiver semantics — deliberately narrow:
 *   - matches EXACTLY ONE advisory by GHSA id; a different/new advisory in the
 *     same package is NOT covered (nothing can hide behind an existing waiver);
 *   - applies only until `expires` (inclusive); PAST that date the advisory
 *     fails CI again — waivers decay by construction, never accumulate;
 *   - a waiver whose advisory is no longer present is reported as STALE (warn)
 *     so the file shrinks over time.
 *
 * Dev-only advisories are printed for visibility but do not fail the gate —
 * the enforcement boundary is what ships.
 *
 * Testability: `evaluateAudit()` is pure; the CLI wires it to `npm audit`.
 * The proof suite lives in src/api/__tests__/auditGate.test.ts.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const GATED_SEVERITIES = new Set(["high", "critical"]);

/** Extract deduped { id, severity, title, package } for gated advisories. */
export function extractAdvisories(auditJson) {
  const out = new Map();
  const vulns = auditJson?.vulnerabilities ?? {};
  for (const [pkg, v] of Object.entries(vulns)) {
    for (const via of v?.via ?? []) {
      if (typeof via !== "object" || via === null) continue; // string = transitive pointer
      const sev = String(via.severity ?? "").toLowerCase();
      if (!GATED_SEVERITIES.has(sev)) continue;
      const m = /GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/i.exec(String(via.url ?? ""));
      const id = m ? m[0].toUpperCase() : `UNIDENTIFIED:${pkg}:${via.title ?? "?"}`;
      if (!out.has(id)) {
        out.set(id, { id, severity: sev, title: String(via.title ?? ""), package: pkg });
      }
    }
  }
  return [...out.values()];
}

/**
 * Pure gate decision.
 * @returns { failures: [{advisory, reason}], waived: [...], stale: [...] }
 */
export function evaluateAudit(auditJson, waiverDoc, now = new Date()) {
  const advisories = extractAdvisories(auditJson);
  const waivers = Array.isArray(waiverDoc?.waivers) ? waiverDoc.waivers : [];
  const byId = new Map(waivers.map(w => [String(w.id ?? "").toUpperCase(), w]));

  const failures = [];
  const waived = [];
  for (const adv of advisories) {
    const w = byId.get(adv.id);
    if (!w) {
      failures.push({ advisory: adv, reason: "no waiver" });
      continue;
    }
    const expires = new Date(`${w.expires}T23:59:59Z`);
    if (!w.expires || Number.isNaN(expires.getTime())) {
      failures.push({ advisory: adv, reason: "waiver has no valid expiry" });
    } else if (now.getTime() > expires.getTime()) {
      failures.push({ advisory: adv, reason: `waiver EXPIRED ${w.expires}` });
    } else {
      waived.push({ advisory: adv, waiver: w });
    }
  }

  const present = new Set(advisories.map(a => a.id));
  const stale = waivers.filter(w => !present.has(String(w.id ?? "").toUpperCase()));
  return { failures, waived, stale };
}

function runNpmAudit(omitDev) {
  const args = ["audit", "--json", ...(omitDev ? ["--omit=dev"] : [])];
  try {
    return JSON.parse(execFileSync("npm", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
  } catch (err) {
    // npm audit exits non-zero when vulnerabilities exist — the JSON is still on stdout.
    if (err && typeof err.stdout === "string" && err.stdout.trim().startsWith("{")) {
      return JSON.parse(err.stdout);
    }
    throw err;
  }
}

function main() {
  let waiverDoc = { waivers: [] };
  try {
    waiverDoc = JSON.parse(readFileSync(new URL("../../.audit-waivers.json", import.meta.url), "utf8"));
  } catch {
    /* no waiver file = no waivers */
  }

  const prod = runNpmAudit(true);
  const { failures, waived, stale } = evaluateAudit(prod, waiverDoc);

  for (const { advisory, waiver } of waived) {
    console.log(`WAIVED ${advisory.id} (${advisory.package}) until ${waiver.expires} — ${waiver.reason}`);
  }
  for (const w of stale) {
    console.log(`STALE WAIVER ${w.id} — advisory no longer present; remove it from .audit-waivers.json`);
  }

  // Dev-dependency advisories: visibility only, never gating.
  const all = runNpmAudit(false);
  const prodIds = new Set(extractAdvisories(prod).map(a => a.id));
  const devOnly = extractAdvisories(all).filter(a => !prodIds.has(a.id));
  for (const a of devOnly) {
    console.log(`INFO dev-only ${a.severity}: ${a.id} (${a.package}) — not gating`);
  }

  if (failures.length > 0) {
    for (const { advisory, reason } of failures) {
      console.error(
        `FAIL ${advisory.severity.toUpperCase()} ${advisory.id} (${advisory.package}): ${advisory.title} — ${reason}`
      );
    }
    console.error(
      `\naudit gate: ${failures.length} unwaived high/critical production advisor${failures.length === 1 ? "y" : "ies"}. ` +
      `Remediate, or add a NAMED, EXPIRING waiver to .audit-waivers.json with operator approval.`
    );
    process.exit(1);
  }
  console.log("audit gate: PASS — no unwaived high/critical production advisories");
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")) {
  main();
}
