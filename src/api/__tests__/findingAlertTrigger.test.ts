/**
 * findingAlertTrigger.test.ts — guards that the live POST /api/findings alert
 * path is behavior-unchanged after extracting recipient selection into the
 * shared selectAlertRecipients. Source-structural (no live-server harness),
 * matching the repo convention.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE = readFileSync(
  resolve(__dirname, "../lib/findingAlertTrigger.ts"),
  "utf8"
);

describe("findingAlertTrigger — severity gate (unchanged)", () => {
  it("only proceeds for Critical/High findings", () => {
    expect(SOURCE).toMatch(
      /if \(severity !== "Critical" && severity !== "High"\) return;/
    );
  });

  it("maps severity to the matching preference column", () => {
    expect(SOURCE).toMatch(
      /severity === "Critical" \? "critical_finding_immediate" : "high_finding_immediate"/
    );
  });
});

describe("findingAlertTrigger — uses shared recipient selection", () => {
  it("imports selectAlertRecipients from the shared module", () => {
    expect(SOURCE).toMatch(
      /import\s*\{\s*selectAlertRecipients\s*\}\s*from\s*"\.\/alerting\/alertRecipients\.js"/
    );
  });

  it("selects recipients inside withTenant (tenant scope preserved)", () => {
    expect(SOURCE).toMatch(
      /await withTenant\(organizationId, async \(\) => \{[\s\S]*?selectAlertRecipients\(organizationId, prefCol\)/
    );
  });

  it("no longer embeds the inline recipient SQL (fully extracted)", () => {
    expect(SOURCE).not.toMatch(/FROM users u\s+JOIN organizations o/);
    expect(SOURCE).not.toMatch(/LEFT JOIN user_alert_preferences/);
  });

  it("still fire-and-forgets sendCriticalFindingAlert per recipient", () => {
    expect(SOURCE).toMatch(
      /for \(const row of rows\)[\s\S]*?sendCriticalFindingAlert\(\{[\s\S]*?\}\)\.catch\(/
    );
  });
});
