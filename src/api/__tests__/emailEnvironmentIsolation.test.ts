import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * P1-2 — email environment isolation, DARK MODE.
 *
 * The defect: staging, demo and production share one Resend account, one API
 * key and one webhook secret, and the account has a single webhook endpoint
 * pointing at PRODUCTION. Every bounce and complaint — whoever generated it —
 * lands on production, verifies (the secret matches), and mutates production's
 * `email_provider_events`, `email_suppressions` and `subscribers`. Proven, not
 * theoretical: a staging signup on 2026-08-10 suppressed an address in prod,
 * and an address suppressed at the provider since April has no row in staging's
 * mirror because staging's webhook never fires.
 *
 * The fix tags every send with its `APP_ENV` and has the receiver compare.
 * These tests hold two lines:
 *   1. the classification is CORRECT for every sender/receiver pair, and
 *   2. dark mode CHANGES NOTHING — a mismatch is recorded, never rejected.
 * (2) is the one that must not silently regress into enforcement.
 */

const ORIGINAL = process.env.APP_ENV;

async function load() {
  vi.resetModules();
  return await import("../infra/emailEnvironment.js");
}

const evt = (tags: unknown) => ({ type: "email.bounced", data: { tags } });

beforeEach(() => { delete process.env.APP_ENV; });
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.APP_ENV;
  else process.env.APP_ENV = ORIGINAL;
});

describe("environment identity is explicit, never inferred", () => {
  it("resolves each configured environment", async () => {
    for (const e of ["production", "staging", "demo"]) {
      process.env.APP_ENV = e;
      const { currentEmailEnvironment } = await load();
      expect(currentEmailEnvironment()).toBe(e);
    }
  });

  it("an UNSET APP_ENV is 'unknown' — it does NOT default to production", async () => {
    delete process.env.APP_ENV;
    const { currentEmailEnvironment } = await load();
    // Defaulting to "production" would make demo (which had no APP_ENV)
    // masquerade as prod and keep mutating it — the exact bug being closed.
    expect(currentEmailEnvironment()).toBe("unknown");
  });

  it("an unrecognised value is 'unknown', and case/whitespace are tolerated", async () => {
    process.env.APP_ENV = "  STAGING ";
    let m = await load();
    expect(m.currentEmailEnvironment()).toBe("staging");
    process.env.APP_ENV = "qa-sandbox";
    m = await load();
    expect(m.currentEmailEnvironment()).toBe("unknown");
  });
});

describe("outbound tagging", () => {
  it("attaches the environment tag", async () => {
    process.env.APP_ENV = "staging";
    const { withEnvironmentTag } = await load();
    expect(withEnvironmentTag()).toEqual([{ name: "environment", value: "staging" }]);
  });

  it("preserves caller tags and never duplicates the environment tag", async () => {
    process.env.APP_ENV = "production";
    const { withEnvironmentTag } = await load();
    const out = withEnvironmentTag([
      { name: "campaign", value: "brief" },
      { name: "environment", value: "spoofed" }
    ]);
    expect(out).toContainEqual({ name: "campaign", value: "brief" });
    expect(out.filter((t) => t.name === "environment")).toEqual([
      { name: "environment", value: "production" }
    ]);
  });
});

describe("reading the environment off an inbound event", () => {
  it("reads the documented OBJECT tag shape", async () => {
    const { readEventEnvironment } = await load();
    expect(readEventEnvironment(evt({ environment: "staging" }))).toBe("staging");
  });

  it("also reads the ARRAY shape the send API accepts", async () => {
    const { readEventEnvironment } = await load();
    expect(readEventEnvironment(evt([{ name: "environment", value: "demo" }]))).toBe("demo");
  });

  it("returns null when the event carries no environment at all", async () => {
    const { readEventEnvironment } = await load();
    for (const p of [evt(undefined), evt({}), evt([]), evt({ other: "x" }), {}, null]) {
      expect(readEventEnvironment(p)).toBeNull();
    }
  });

  it("distinguishes an UNRECOGNISED tag from an ABSENT one", async () => {
    const { readEventEnvironment } = await load();
    expect(readEventEnvironment(evt({ environment: "qa" }))).toBe("unknown");
    expect(readEventEnvironment(evt({}))).toBeNull();
  });
});

describe("classification — every sender/receiver pair", () => {
  it("same-environment events MATCH", async () => {
    const { classifyEventEnvironment } = await load();
    for (const e of ["production", "staging", "demo"] as const) {
      expect(classifyEventEnvironment(e, e)).toBe("match");
    }
  });

  it("staging -> production is a MISMATCH (the incident that started this)", async () => {
    const { classifyEventEnvironment } = await load();
    expect(classifyEventEnvironment("staging", "production")).toBe("mismatch");
  });

  it("production -> staging is a MISMATCH", async () => {
    const { classifyEventEnvironment } = await load();
    expect(classifyEventEnvironment("production", "staging")).toBe("mismatch");
  });

  it("demo cross-environment cases are MISMATCHES both ways", async () => {
    const { classifyEventEnvironment } = await load();
    expect(classifyEventEnvironment("demo", "production")).toBe("mismatch");
    expect(classifyEventEnvironment("demo", "staging")).toBe("mismatch");
    expect(classifyEventEnvironment("production", "demo")).toBe("mismatch");
    expect(classifyEventEnvironment("staging", "demo")).toBe("mismatch");
  });

  it("a missing tag is MISSING — not a match, not a mismatch", async () => {
    const { classifyEventEnvironment } = await load();
    // Pre-rollout mail in flight lands here. Under enforcement this class must
    // be decided deliberately, which is why it is not folded into either side.
    expect(classifyEventEnvironment(null, "production")).toBe("missing");
  });

  it("an unknown identity on EITHER side is INDETERMINATE, never a match", async () => {
    const { classifyEventEnvironment } = await load();
    expect(classifyEventEnvironment("production", "unknown")).toBe("indeterminate");
    expect(classifyEventEnvironment("unknown", "production")).toBe("indeterminate");
    // A receiver with no identity must never report clean agreement.
    expect(classifyEventEnvironment("production", "unknown")).not.toBe("match");
  });

  it("defaults the receiver to this service's identity", async () => {
    process.env.APP_ENV = "demo";
    const { classifyEventEnvironment } = await load();
    expect(classifyEventEnvironment("demo")).toBe("match");
    expect(classifyEventEnvironment("production")).toBe("mismatch");
  });
});

// ── Source guards: dark mode, signature, and full send-site coverage ──────
describe("dark mode changes nothing yet", () => {
  const hook = readFileSync(
    resolve(process.cwd(), "src/api/routes/emailProviderWebhook.ts"),
    "utf8"
  );

  it("classifies the event environment", () => {
    expect(hook).toContain("classifyEventEnvironment");
    expect(hook).toContain("readEventEnvironment");
  });

  it("does NOT reject on mismatch — no early return between classify and insert", () => {
    const from = hook.indexOf("const environmentMatch");
    const to = hook.indexOf("await client.query(\"BEGIN\")");
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    const between = hook.slice(from, to);
    expect(between).not.toMatch(/return res\.status\(4\d\d\)/);
    expect(between).not.toMatch(/\breturn\b.*res\.status/);
  });

  it("records every non-match at warn, so nothing passes silently", () => {
    expect(hook).toContain("logger.warn");
    expect(hook).toContain("wouldRejectUnderEnforcement");
    expect(hook).toContain('mode: "dark"');
  });

  it("telemetry carries both identities and the event type, but no message content", () => {
    const raw = hook.slice(hook.indexOf("const environmentTelemetry"), hook.indexOf("if (environmentMatch"));
    for (const f of ["senderEnvironment", "receiverEnvironment", "classification", "eventType"]) {
      expect(raw).toContain(f);
    }
    // Assert on the CODE, not the prose: comments here legitimately discuss the
    // fields being withheld, and matching those words would fail on the
    // explanation rather than on a real leak.
    const code = raw
      .split("\n")
      .filter((l) => !l.trim().startsWith("//"))
      .join("\n");
    // Never log what the message said or who it went to.
    expect(code).not.toMatch(/\bhtml\b|\bsubject\b|\bpayload\b/);
    expect(code).not.toMatch(/\bemail\b\s*[,:]/);
  });

  it("signature verification still runs BEFORE any environment logic", () => {
    expect(hook.indexOf("verifyWebhookSignature")).toBeLessThan(hook.indexOf("readEventEnvironment"));
    expect(hook).toContain('invalid_webhook_signature');
    expect(hook).toContain("res.status(401)");
  });
});

describe("every known send site carries the environment tag", () => {
  // A tag applied to nine of ten senders leaves the tenth unattributable, and
  // its events would be classified `missing` forever. Enumerated explicitly so
  // a NEW sender added without a tag fails here rather than in production.
  const SENDERS = [
    "src/api/infra/email.ts",
    "src/api/lib/alertEmailService.ts",
    "src/api/lib/alerting/alertService.ts",
    "src/api/lib/assignmentAlertTrigger.ts",
    "src/api/lib/slaBreachScheduler.ts",
    "src/api/lib/briefEmailSender.ts",
    "src/api/routes/accountRecovery.ts",
    "src/api/routes/customerAuth.ts",
    "src/api/routes/teamInvites.ts"
  ];

  it.each(SENDERS)("%s tags every send", (file) => {
    const src = readFileSync(resolve(process.cwd(), file), "utf8");
    // Count real send calls: SDK `emails.send(` plus the raw REST POST.
    const sdk = (src.match(/emails\.send\(\{/g) ?? []).length;
    const rest = (src.match(/RESEND_API_URL, \{/g) ?? []).length;
    const sends = sdk + rest;
    const tagged = (src.match(/withEnvironmentTag\(\)/g) ?? []).length;
    expect(sends).toBeGreaterThan(0);
    expect(tagged).toBe(sends);
  });

  it("no sender was missed — the repo has no untagged Resend send", () => {
    const all = SENDERS.map((f) => readFileSync(resolve(process.cwd(), f), "utf8")).join("\n");
    const sends = (all.match(/emails\.send\(\{/g) ?? []).length + (all.match(/RESEND_API_URL, \{/g) ?? []).length;
    const tagged = (all.match(/withEnvironmentTag\(\)/g) ?? []).length;
    expect(tagged).toBe(sends);
    expect(sends).toBe(11);
  });
});
