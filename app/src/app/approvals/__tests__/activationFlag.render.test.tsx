/**
 * activationFlag.render.test.tsx — the app half of the risk-acceptance
 * ACTIVATION control (NAV-1 / P1-C).
 *
 * NAV-1 declared "Approvals" in the LEGACY nav model, which is the model
 * production actually renders. That fixes a nav orphan, and it introduces a
 * hazard the pen-test package did not have: /approvals is entitlement-gated but
 * NOT flag-gated in its page body — it degrades to an "unavailable" state when
 * the engine 404s. Advertising it in the menu while both backing flags are off
 * would have put a dead destination in front of every platform user in prod.
 *
 * So the nav entry carries `risk_acceptance`, mirroring the engine's
 * SECURELOGIC_RISK_ACCEPTANCE_ENABLED. What THIS file pins is the boundary of
 * that decision — the part most likely to be broken later by someone "tidying
 * up" the gates:
 *
 *   the flag governs NAV VISIBILITY, and nothing else.
 *
 * It is deliberately NOT a page gate. Someone who types the URL with the flag
 * off gets exactly what they got before this package: the page, the entitlement
 * redirect if they lack it, and both approval families dark because the ENGINE
 * refuses them. Turning the nav flag into a page gate would be a behaviour
 * change to a live production surface smuggled in under a navigation fix — and
 * it would also hide the risk-LIFECYCLE approval family, which sits behind a
 * different flag entirely.
 *
 * The engine remains the authority: routes 404 while dark (see
 * src/api/lib/riskAcceptanceFeatureFlag.ts + riskAcceptances.ts), and no app-tier
 * value can grant what the engine refuses.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderPage, expectRedirect, signedIn, signedOut, sp } from "@/test/harness";
import { riskAcceptanceEnabled } from "@/lib/riskAcceptanceFeatureFlag";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const actions = vi.hoisted(() => ({
  approveRiskAcceptanceAction: vi.fn(async () => ({})),
  rejectRiskAcceptanceAction: vi.fn(async () => ({})),
  withdrawRiskAcceptanceAction: vi.fn(async () => ({})),
  proposeRiskAcceptanceAction: vi.fn(async () => ({})),
  attachRiskAcceptanceEvidenceAction: vi.fn(async () => ({})),
}));
vi.mock("@/app/findings/[id]/riskAcceptanceActions", () => actions);

import ApprovalsPage from "../page";

function json(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/**
 * The engine as production has it TODAY: risk-acceptance dark (404) and
 * risk-lifecycle dark (404), both proven live on 2026-08-27 —
 * GET /api/risk-acceptances and GET /api/approvals each return the flag
 * middleware's bare `{"error":"not_found"}`, with no `path` key (a route MISS
 * adds one). Entitlement is a platform tier, so nothing here is confounded by
 * the redirect.
 */
function darkEngine(entitlementLevel = "platform") {
  const fetchMock = vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("/api/me")) return json(200, { entitlementLevel });
    if (u.includes("/api/auth/me")) return json(200, { role: "admin", id: "user-2" });
    if (u.includes("/api/risk-acceptances")) return json(404, { error: "not_found" });
    if (u.includes("/api/approvals")) return json(404, { error: "not_found" });
    return json(200, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  signedIn({ userId: "user-2", jwtToken: "jwt-approver" });
  delete process.env["SECURELOGIC_RISK_ACCEPTANCE_ENABLED"];
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  process.env = { ...ORIGINAL_ENV };
});

describe("riskAcceptanceEnabled — fail-closed resolver", () => {
  it("is TRUE only for the exact string 'true'", () => {
    expect(riskAcceptanceEnabled({ SECURELOGIC_RISK_ACCEPTANCE_ENABLED: "true" })).toBe(true);
  });

  it.each(["false", "1", "TRUE", "True", "yes", "on", "", "  true  "])(
    "is FALSE for %o — no permissive fallback",
    (val) => {
      expect(riskAcceptanceEnabled({ SECURELOGIC_RISK_ACCEPTANCE_ENABLED: val })).toBe(false);
    }
  );

  it("is FALSE when the key is absent entirely (missing === off)", () => {
    // This is production's state before P1-C declared the key, and the reason
    // declaring it "false" is a no-op rather than a change.
    expect(riskAcceptanceEnabled({})).toBe(false);
  });

  it("reads the SAME key the engine reads, character for character", () => {
    // Two tiers, one key. If these ever drift, the nav can advertise a
    // destination whose routes 404 — the exact defect NAV-1 set out to avoid.
    const seen = riskAcceptanceEnabled({ SECURELOGIC_RISK_ACCEPTANCE_ENABLED: "true" });
    expect(seen).toBe(true);
    expect(riskAcceptanceEnabled({ SECURELOGIC_RISK_ACCEPTANCE: "true" })).toBe(false);
    expect(riskAcceptanceEnabled({ RISK_ACCEPTANCE_ENABLED: "true" })).toBe(false);
  });

  it("does not read process.env when an explicit env is supplied", () => {
    process.env["SECURELOGIC_RISK_ACCEPTANCE_ENABLED"] = "true";
    expect(riskAcceptanceEnabled({})).toBe(false);
  });
});

describe("NAV-1 — the flag governs NAV VISIBILITY only, never page authorization", () => {
  it("flag OFF: /approvals still renders for an entitled user — unchanged behaviour", async () => {
    // The nav declaration must not have turned into a new page gate. Someone
    // arriving from the /risks back-link or a bookmark sees what they saw
    // before this package.
    darkEngine();
    await renderPage(ApprovalsPage, { params: sp({}) } as never);
    expect(await screen.findByRole("heading", { name: /^Approvals$/i })).toBeInTheDocument();
  });

  it("flag OFF: the risk-acceptance capability is STILL dark on the page", async () => {
    // Direct URL access does not bypass the flag, because the flag that matters
    // for the capability is the ENGINE's — and it 404s. No acceptance queue, no
    // approve/reject affordances, and NOT a "0 awaiting decision" lie.
    darkEngine();
    await renderPage(ApprovalsPage, { params: sp({}) } as never);

    expect(screen.queryByRole("heading", { name: /Risk acceptances/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/awaiting decision/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Approve$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Reject$/ })).not.toBeInTheDocument();
  });

  it("flag ON does not change the page either — it only lights the nav entry", async () => {
    // The app-tier value cannot open a route the engine refuses. Same dark
    // engine, flag on: identical page.
    process.env["SECURELOGIC_RISK_ACCEPTANCE_ENABLED"] = "true";
    darkEngine();
    await renderPage(ApprovalsPage, { params: sp({}) } as never);

    expect(await screen.findByRole("heading", { name: /^Approvals$/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Risk acceptances/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Approve$/ })).not.toBeInTheDocument();
  });

  it("keeps the entitlement redirect, at BOTH flag positions", async () => {
    // Entitlement is the authorization control and it is untouched by NAV-1. A
    // sub-platform account is sent to /dashboard whether the flag is on or off.
    for (const value of [undefined, "true"]) {
      if (value) process.env["SECURELOGIC_RISK_ACCEPTANCE_ENABLED"] = value;
      else delete process.env["SECURELOGIC_RISK_ACCEPTANCE_ENABLED"];
      darkEngine("starter");
      expect(await expectRedirect(ApprovalsPage, { params: sp({}) } as never)).toBe("/dashboard");
    }
  });

  it("keeps the unauthenticated redirect, at BOTH flag positions", async () => {
    for (const value of [undefined, "true"]) {
      if (value) process.env["SECURELOGIC_RISK_ACCEPTANCE_ENABLED"] = value;
      else delete process.env["SECURELOGIC_RISK_ACCEPTANCE_ENABLED"];
      signedOut();
      darkEngine();
      expect(await expectRedirect(ApprovalsPage, { params: sp({}) } as never)).toBe("/login");
    }
  });
});
