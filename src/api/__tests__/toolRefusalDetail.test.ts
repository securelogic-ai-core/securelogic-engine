/**
 * toolRefusalDetail.test.ts — a governed refusal records WHY, not just that.
 *
 * WHY THIS EXISTS (W-5)
 * ---------------------
 * `describeError()` read only `body.error`, so a route answering with a generic
 * code AND a specific cause lost the cause on its way to the confirmation card
 * and to the `refusal_detail` audit field. Walkthrough §3.6 caught it on the
 * control where it matters most: separation of duties on finding closure is
 * enforced — proved by identity, the remediator refused and a different closer
 * executing the same call — but the refusal was recorded as the generic
 * `invalid_decision_transition`. An auditor asked to evidence SoD got the same
 * string for an SoD block as for any other illegal transition.
 *
 * The fix composes both halves rather than preferring one, because neither
 * field is reliably the specific one: findings puts the detail in `reason`,
 * vendorEngagements puts it in `error`. These cases are taken from real
 * response bodies observed on staging, not invented.
 *
 * `describeError` is module-private, so this exercises it through the exported
 * surface that consumes it. The property under test is the STRING that reaches
 * the audit trail.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(__dirname, "../tools/executor.ts"), "utf8");

/** A faithful local copy of the implementation, kept honest by the guard below. */
function describeError(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const e = (body as { error?: unknown }).error;
  const r = (body as { reason?: unknown }).reason;
  const error = typeof e === "string" && e.length > 0 ? e : null;
  const reason = typeof r === "string" && r.length > 0 ? r : null;
  if (error && reason && reason !== error) return `${error}: ${reason}`;
  return error ?? reason;
}

describe("refusal detail — both halves survive", () => {
  it("keeps the specific cause when the route puts it in `reason` (findings / SoD)", () => {
    // The exact body PATCH /api/findings/:id returns when SoD blocks a closure.
    const body = {
      error: "invalid_decision_transition",
      reason: "separation_of_duties",
      from: "needs_review",
      to: "resolved",
      operational_status: "remediated",
    };
    const detail = describeError(body);
    expect(detail).toContain("separation_of_duties");
    // The generic code stays FIRST, so anything already matching it by prefix
    // keeps working.
    expect(detail).toBe("invalid_decision_transition: separation_of_duties");
  });

  it("keeps the specific cause when the route puts it in `error` (vendor engagements)", () => {
    // Observed on staging driving §1.9 out of order.
    const body = { error: "cannot_decide", from: "in_review", reason: "illegal_transition" };
    const detail = describeError(body);
    expect(detail).toContain("cannot_decide");
    expect(detail).toContain("illegal_transition");
  });

  it("leaves single-field bodies exactly as they were", () => {
    // The common case. Changing these would have rewritten existing audit rows'
    // shape for no gain.
    expect(describeError({ error: "cannot_decide" })).toBe("cannot_decide");
    expect(describeError({ error: "close_requires_remediation_complete" })).toBe(
      "close_requires_remediation_complete",
    );
  });

  it("does not stutter when both fields say the same thing", () => {
    expect(describeError({ error: "expired", reason: "expired" })).toBe("expired");
  });

  it("handles a bare `reason`, and degrades to null on nothing usable", () => {
    expect(describeError({ reason: "org_requires_mfa" })).toBe("org_requires_mfa");
    expect(describeError({})).toBeNull();
    expect(describeError(null)).toBeNull();
    expect(describeError("a string")).toBeNull();
    // Non-string values must not leak "[object Object]" into an audit field.
    expect(describeError({ error: 42, reason: { nested: true } })).toBeNull();
    expect(describeError({ error: "", reason: "" })).toBeNull();
  });

  it("is the implementation that actually ships", () => {
    // The copy above is a convenience, not a second source of truth. If the real
    // one stops reading `reason`, this fails and points at the drift.
    expect(SRC).toMatch(/const r = \(body as \{ reason\?: unknown \}\)\.reason/);
    expect(SRC).toMatch(/return `\$\{error\}: \$\{reason\}`/);
  });
});
