/**
 * activationFlag.render.test.tsx — the app half of the pen-test ACTIVATION
 * control (PEN-1 / T2-I).
 *
 * PEN-1 shipped entitlement-gated only. Entitlement answers "who may use this";
 * it cannot answer "is this exposed at all", so the capability would have
 * reached production at the next promotion with no way to turn it off. These
 * cases pin the second control on every app door into it, and pin that the two
 * controls are INDEPENDENT and fail DIFFERENTLY on purpose:
 *
 *   flag false                     -> notFound(), whatever the entitlement
 *   flag true  + no entitlement    -> redirect("/dashboard"), as before
 *   flag true  + valid entitlement -> the #864 surface renders, unchanged
 *
 * The distinction matters: notFound() says the capability does not exist for
 * anyone; the redirect says it exists and this account may not use it. A
 * disabled capability must never leak the second answer.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderPage, expectRedirect, signedIn } from "@/test/harness";
import { aPenTestEngagement } from "@/test/fixtures";

const api = vi.hoisted(() => ({
  getPenTestEngagements: vi.fn(),
  getPenTestEngagement: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}));

import PenTestsPage from "../page";
import PenTestDetailPage from "../[id]/page";
import NewPenTestPage from "../new/page";
import { createPenTest } from "../new/actions";
import { penTestEnabled } from "@/lib/penTestFeatureFlag";

const ENGAGEMENT = aPenTestEngagement();
const ORIGINAL_ENV = { ...process.env };

const detailProps = { params: Promise.resolve({ id: ENGAGEMENT.id }) };

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
  api.getPenTestEngagements.mockResolvedValue({
    engagements: [ENGAGEMENT],
    count: 1,
  });
  api.getPenTestEngagement.mockResolvedValue({ engagement: ENGAGEMENT });
  delete process.env["SECURELOGIC_PEN_TEST_ENABLED"];
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("penTestEnabled — fail-closed resolver", () => {
  it("is TRUE only for the exact string 'true'", () => {
    expect(penTestEnabled({ SECURELOGIC_PEN_TEST_ENABLED: "true" })).toBe(true);
  });

  it.each(["false", "1", "TRUE", "yes", "", "  true  "])(
    "is FALSE for %o — no permissive fallback",
    (val) => {
      expect(penTestEnabled({ SECURELOGIC_PEN_TEST_ENABLED: val })).toBe(false);
    }
  );

  it("is FALSE when the key is absent entirely (missing === off)", () => {
    expect(penTestEnabled({})).toBe(false);
  });
});

describe("FLAG FALSE — every app door is shut", () => {
  it("/pen-tests is notFound(), not an empty register", async () => {
    expect(await expectRedirect(PenTestsPage, {})).toBe("__not_found__");
  });

  it("/pen-tests/[id] is notFound() — a deep link cannot reach it", async () => {
    expect(await expectRedirect(PenTestDetailPage, detailProps)).toBe("__not_found__");
  });

  it("/pen-tests/new is notFound() — the create form is unreachable", async () => {
    expect(await expectRedirect(NewPenTestPage, {})).toBe("__not_found__");
  });

  it("fetches NO data when dark — the gate precedes every load", async () => {
    await expectRedirect(PenTestsPage, {});
    await expectRedirect(PenTestDetailPage, detailProps);
    expect(api.getPenTestEngagements).not.toHaveBeenCalled();
    expect(api.getPenTestEngagement).not.toHaveBeenCalled();
  });

  it("the createPenTest server action refuses a DIRECT invocation", async () => {
    // The bypass this closes: a server action is its own endpoint and can be
    // POSTed by action id without the page whose gate would have stopped a
    // browser ever rendering.
    const form = new FormData();
    form.set("name", "Attempted while dark");
    expect(await createPenTest(form)).toEqual({ error: "Not available" });
  });

  it("a PLATFORM entitlement cannot bypass the flag on any page", async () => {
    signedIn({ entitlementLevel: "platform" });
    expect(await expectRedirect(PenTestsPage, {})).toBe("__not_found__");
    expect(await expectRedirect(PenTestDetailPage, detailProps)).toBe("__not_found__");
    expect(await expectRedirect(NewPenTestPage, {})).toBe("__not_found__");
  });

  it("answers notFound(), NOT the entitlement redirect — a dark capability leaks nothing", async () => {
    signedIn({ entitlementLevel: "free" });
    // Flag-off wins over the entitlement branch, so an unentitled caller cannot
    // tell a disabled capability from one this account merely lacks.
    expect(await expectRedirect(PenTestsPage, {})).toBe("__not_found__");
  });
});

describe("FLAG TRUE + NO ENTITLEMENT — still unavailable", () => {
  beforeEach(() => {
    process.env["SECURELOGIC_PEN_TEST_ENABLED"] = "true";
    signedIn({ entitlementLevel: "free" });
  });

  it("/pen-tests still redirects a sub-platform caller to /dashboard", async () => {
    expect(await expectRedirect(PenTestsPage, {})).toBe("/dashboard");
  });

  it("/pen-tests/new still redirects a sub-platform caller to /dashboard", async () => {
    expect(await expectRedirect(NewPenTestPage, {})).toBe("/dashboard");
  });

  it("turning the flag on grants nothing entitlement would have refused", async () => {
    await expectRedirect(PenTestsPage, {});
    expect(api.getPenTestEngagements).not.toHaveBeenCalled();
  });

  it("a signed-out caller still goes to /login, flag notwithstanding", async () => {
    signedIn({ jwtToken: undefined, apiKey: undefined });
    expect(await expectRedirect(PenTestsPage, {})).toBe("/login");
  });
});

describe("FLAG TRUE + VALID ENTITLEMENT — the #864 surface is unchanged", () => {
  beforeEach(() => {
    process.env["SECURELOGIC_PEN_TEST_ENABLED"] = "true";
    signedIn();
  });

  it("/pen-tests renders the engagement register again", async () => {
    await renderPage(PenTestsPage, {});
    expect(screen.getByText(ENGAGEMENT.name)).toBeInTheDocument();
    expect(api.getPenTestEngagements).toHaveBeenCalled();
  });

  it("/pen-tests/[id] renders the engagement again", async () => {
    await renderPage(PenTestDetailPage, detailProps);
    expect(screen.getByText(ENGAGEMENT.name)).toBeInTheDocument();
  });

  it("/pen-tests/new renders the create form again", async () => {
    const { container } = await renderPage(NewPenTestPage, {});
    expect(container.querySelector("form")).toBeTruthy();
  });
});
