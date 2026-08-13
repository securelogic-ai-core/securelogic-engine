import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Structural writer guard for the B1 demotion (Launch Completion 1).
 *
 * PROVES, at the source level, that no production code path writes the demoted
 * legacy Vendor Assurance tables outside the sanctioned allowlist:
 *
 *   - the three flag-gated legacy routes (vendorAssessments.ts,
 *     vendorReviews.ts) — every INSERT/UPDATE there sits behind
 *     legacyVendorWritesEnabled();
 *   - the GDPR account-deletion reaper's reviewer_id scrub
 *     (accountDeletionReaper.ts via accountDeletionReaperPolicy.ts) — an
 *     erasure obligation, not a workflow writer.
 *
 * Anything else that INSERTs/UPDATEs/DELETEs vendor_assessments or
 * vendor_reviews inside src/ fails this test with the offending file:line, so
 * a future "competing writer" cannot land silently. Seeds (scripts/) and
 * isolation-test fixtures write via direct SQL as data fixtures and are
 * outside src/, hence outside this guard's scope by construction.
 *
 * Modelled on the tenant-wrap structural guard: crude on purpose — a regex
 * over source text catches string-built SQL that the type system can't see.
 */

const SRC_ROOT = path.join(process.cwd(), "src");

/** file (relative to src/) → substrings identifying each sanctioned write site */
const ALLOWLIST: Record<string, string[]> = {
  "api/routes/vendorAssessments.ts": ["INSERT INTO vendor_assessments"],
  "api/routes/vendorReviews.ts": [
    "INSERT INTO vendor_reviews",
    "UPDATE vendor_reviews",
  ],
  // Table name arrives via REVIEWER_TEXT_TABLES interpolation, but the policy
  // file names vendor_reviews literally — keep it visible to the guard.
  "api/lib/accountDeletionReaperPolicy.ts": ["vendor_reviews"],
};

const WRITE_RE =
  /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(vendor_assessments|vendor_reviews)\b/gi;

/** Directories excluded from the prod build — dead zones, not shipped. */
const DEAD_ZONE = /^(?:_|.*\/_)/;

function* walk(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = path.relative(SRC_ROOT, path.join(dir, e.name));
    if (e.isDirectory()) {
      if (DEAD_ZONE.test(rel)) continue;
      yield* walk(path.join(dir, e.name));
    } else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) {
      yield rel;
    }
  }
}

describe("legacy vendor writer guard (B1)", () => {
  it("no write to vendor_assessments / vendor_reviews exists in src/ outside the allowlist", () => {
    const offenders: string[] = [];

    for (const rel of walk(SRC_ROOT)) {
      const text = fs.readFileSync(path.join(SRC_ROOT, rel), "utf8");
      WRITE_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = WRITE_RE.exec(text)) !== null) {
        const allowed = ALLOWLIST[rel]?.some((s) => text.includes(s));
        if (!allowed) {
          const line = text.slice(0, m.index).split("\n").length;
          offenders.push(`${rel}:${line} — ${m[0]}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("every allowlisted route write site still sits behind the demotion flag", () => {
    for (const rel of [
      "api/routes/vendorAssessments.ts",
      "api/routes/vendorReviews.ts",
    ]) {
      const text = fs.readFileSync(path.join(SRC_ROOT, rel), "utf8");
      expect(
        text.includes("legacyVendorWritesEnabled"),
        `${rel} must gate its legacy writes with legacyVendorWritesEnabled()`
      ).toBe(true);
    }
  });

  it("the allowlist itself is still accurate (each named site exists)", () => {
    for (const [rel, needles] of Object.entries(ALLOWLIST)) {
      const text = fs.readFileSync(path.join(SRC_ROOT, rel), "utf8");
      for (const needle of needles) {
        expect(
          text.includes(needle),
          `${rel} no longer contains "${needle}" — update the allowlist`
        ).toBe(true);
      }
    }
  });
});
