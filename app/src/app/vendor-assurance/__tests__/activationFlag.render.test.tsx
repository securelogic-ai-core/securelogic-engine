/**
 * activationFlag.render.test.tsx — the app half of the Vendor Assurance
 * ACTIVATION control (VA-NAV-1).
 *
 * The six pages under /vendor-assurance and /vendor-engagements shipped
 * entitlement-gated only; the engine's SECURELOGIC_VENDOR_ASSURANCE_ENABLED was
 * the sole activation switch and the app never read it. Hiding the nav group
 * (navigationFlags.test.ts) is presentation, not authorization — these cases
 * pin the DIRECT-ROUTE gate on every page, independent of the menu:
 *
 *   flag off                       -> notFound(), whatever the entitlement
 *   flag on  + no entitlement      -> redirect("/dashboard"), as before
 *   flag on  + valid entitlement   -> the page renders, unchanged
 *
 * Resolver semantics deliberately mirror the ENGINE resolver
 * (src/api/lib/vendorAssuranceFeatureFlag.ts), including its non-production
 * default, so the two tiers can never disagree. vitest runs with
 * NODE_ENV=test, so "flag off" here is pinned by setting NODE_ENV=production
 * with the key absent — exactly the production posture.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderPage, expectRedirect, signedIn } from "@/test/harness";
import { aVendor, aVendorAssuranceDocument } from "@/test/fixtures";

const api = vi.hoisted(() => ({
  listVendorEngagements: vi.fn(),
  listVendorAssuranceDocuments: vi.fn(),
  getVendorEngagement: vi.fn(),
  getVendorEngagementResponses: vi.fn(),
  listVendorEngagementComments: vi.fn(),
  listVendorEngagementEvidence: vi.fn(),
  getVendorAssuranceExtraction: vi.fn(),
  getVendorAssuranceDocumentPdfUrl: vi.fn(),
  getCuecsForDocument: vi.fn(),
  getVendors: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}));

import VendorAssurancePage from "../page";
import VendorAssuranceQueuePage from "../queue/page";
import VendorAssuranceDocumentPage from "../[documentId]/page";
import VendorEngagementsPage from "../../vendor-engagements/page";
import VendorEngagementDetailPage from "../../vendor-engagements/[id]/page";
import NewVendorEngagementPage from "../../vendor-engagements/new/page";
import { vendorAssuranceEnabled } from "@/lib/vendorAssuranceFeatureFlag";

const ORIGINAL_ENV = { ...process.env };
const DOC = aVendorAssuranceDocument();
const VENDOR = aVendor();

const noParams = { searchParams: Promise.resolve({}) };
const docProps = { params: Promise.resolve({ documentId: DOC.id }) };
const engProps = { params: Promise.resolve({ id: "eng-1" }) };

function setFlag(state: "on" | "off" | "absent-nonprod") {
  delete process.env["SECURELOGIC_VENDOR_ASSURANCE_ENABLED"];
  if (state === "on") process.env["SECURELOGIC_VENDOR_ASSURANCE_ENABLED"] = "true";
  // vitest's NODE_ENV is "test"; the production posture is what we must pin.
  (process.env as Record<string, string | undefined>)["NODE_ENV"] =
    state === "absent-nonprod" ? "test" : "production";
}

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
  api.listVendorEngagements.mockResolvedValue({ engagements: [], count: 0 });
  api.listVendorAssuranceDocuments.mockResolvedValue({ documents: [DOC] });
  api.getVendorEngagement.mockResolvedValue(null);
  api.getVendorEngagementResponses.mockResolvedValue(null);
  api.listVendorEngagementComments.mockResolvedValue(null);
  api.listVendorEngagementEvidence.mockResolvedValue(null);
  api.getVendorAssuranceExtraction.mockResolvedValue(null);
  api.getVendorAssuranceDocumentPdfUrl.mockResolvedValue(null);
  api.getCuecsForDocument.mockResolvedValue(null);
  api.getVendors.mockResolvedValue({ vendors: [VENDOR], count: 1 });
  setFlag("off");
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("vendorAssuranceEnabled — mirrors the engine resolver exactly", () => {
  it("is TRUE for the exact string 'true' in production", () => {
    expect(vendorAssuranceEnabled({ SECURELOGIC_VENDOR_ASSURANCE_ENABLED: "true", NODE_ENV: "production" })).toBe(true);
  });

  it.each(["false", "1", "TRUE", "yes", "", "  true  "])(
    "is FALSE in production for %o — no permissive fallback",
    (val) => {
      expect(vendorAssuranceEnabled({ SECURELOGIC_VENDOR_ASSURANCE_ENABLED: val, NODE_ENV: "production" })).toBe(false);
    }
  );

  it("is FALSE in production when the key is ABSENT — missing === off where it ships", () => {
    expect(vendorAssuranceEnabled({ NODE_ENV: "production" })).toBe(false);
  });

  it("is TRUE off-production when the key is absent — the ruled engine dev/test default", () => {
    expect(vendorAssuranceEnabled({ NODE_ENV: "test" })).toBe(true);
    expect(vendorAssuranceEnabled({ NODE_ENV: "development" })).toBe(true);
    expect(vendorAssuranceEnabled({})).toBe(true);
  });

  it("agrees with the engine on every combination the engine's own suite pins", () => {
    // src/api/__tests__/vendorAssuranceFeatureFlag.test.ts, case for case.
    expect(vendorAssuranceEnabled({ SECURELOGIC_VENDOR_ASSURANCE_ENABLED: "true", NODE_ENV: "development" })).toBe(true);
    expect(vendorAssuranceEnabled({ SECURELOGIC_VENDOR_ASSURANCE_ENABLED: "yes", NODE_ENV: "production" })).toBe(false);
  });
});

describe("FLAG OFF (production, key absent) — every direct route is shut", () => {
  it("/vendor-assurance is notFound(), not an empty overview", async () => {
    expect(await expectRedirect(VendorAssurancePage, {})).toBe("__not_found__");
  });

  it("/vendor-assurance/queue is notFound()", async () => {
    expect(await expectRedirect(VendorAssuranceQueuePage, noParams)).toBe("__not_found__");
  });

  it("/vendor-assurance/[documentId] is notFound() — a deep link cannot reach it", async () => {
    expect(await expectRedirect(VendorAssuranceDocumentPage, docProps)).toBe("__not_found__");
  });

  it("/vendor-engagements is notFound()", async () => {
    expect(await expectRedirect(VendorEngagementsPage, noParams)).toBe("__not_found__");
  });

  it("/vendor-engagements/[id] is notFound()", async () => {
    expect(await expectRedirect(VendorEngagementDetailPage, engProps)).toBe("__not_found__");
  });

  it("/vendor-engagements/new is notFound() — the intake form is unreachable", async () => {
    expect(await expectRedirect(NewVendorEngagementPage, noParams)).toBe("__not_found__");
  });

  it("fetches NO data when dark — the gate precedes every load", async () => {
    await expectRedirect(VendorAssurancePage, {});
    await expectRedirect(VendorAssuranceQueuePage, noParams);
    await expectRedirect(VendorAssuranceDocumentPage, docProps);
    await expectRedirect(VendorEngagementsPage, noParams);
    await expectRedirect(VendorEngagementDetailPage, engProps);
    await expectRedirect(NewVendorEngagementPage, noParams);
    for (const fn of Object.values(api)) expect(fn).not.toHaveBeenCalled();
  });

  it("a PLATFORM entitlement cannot bypass the flag on any page", async () => {
    signedIn({ entitlementLevel: "platform" });
    expect(await expectRedirect(VendorAssurancePage, {})).toBe("__not_found__");
    expect(await expectRedirect(VendorEngagementsPage, noParams)).toBe("__not_found__");
    expect(await expectRedirect(VendorAssuranceQueuePage, noParams)).toBe("__not_found__");
  });

  it("answers notFound(), NOT the entitlement redirect — a dark capability leaks nothing", async () => {
    signedIn({ entitlementLevel: "free" });
    expect(await expectRedirect(VendorAssurancePage, {})).toBe("__not_found__");
    expect(await expectRedirect(VendorEngagementsPage, noParams)).toBe("__not_found__");
  });

  it("'false' in production is off too — explicit and absent are the same answer", async () => {
    process.env["SECURELOGIC_VENDOR_ASSURANCE_ENABLED"] = "false";
    expect(await expectRedirect(VendorAssurancePage, {})).toBe("__not_found__");
  });
});

describe("FLAG ON + NO ENTITLEMENT — still unavailable", () => {
  beforeEach(() => {
    setFlag("on");
    signedIn({ entitlementLevel: "free" });
  });

  it("/vendor-assurance still redirects a sub-platform caller to /dashboard", async () => {
    expect(await expectRedirect(VendorAssurancePage, {})).toBe("/dashboard");
  });

  it("/vendor-engagements/new still redirects a sub-platform caller to /dashboard", async () => {
    expect(await expectRedirect(NewVendorEngagementPage, noParams)).toBe("/dashboard");
  });

  it("/vendor-assurance/queue still redirects a sub-platform caller to /dashboard", async () => {
    expect(await expectRedirect(VendorAssuranceQueuePage, noParams)).toBe("/dashboard");
  });

  it("turning the flag on grants nothing entitlement would have refused", async () => {
    await expectRedirect(VendorAssurancePage, {});
    expect(api.listVendorEngagements).not.toHaveBeenCalled();
  });

  it("a signed-out caller still goes to /login, flag notwithstanding", async () => {
    signedIn({ jwtToken: undefined, apiKey: undefined });
    expect(await expectRedirect(VendorAssurancePage, {})).toBe("/login");
  });
});

describe("FLAG ON + VALID ENTITLEMENT — the surface is unchanged", () => {
  beforeEach(() => {
    setFlag("on");
    signedIn();
  });

  it("/vendor-assurance renders and loads its data again", async () => {
    await renderPage(VendorAssurancePage, {});
    expect(api.listVendorEngagements).toHaveBeenCalled();
    expect(api.listVendorAssuranceDocuments).toHaveBeenCalled();
  });

  it("/vendor-engagements renders the (empty) register again", async () => {
    await renderPage(VendorEngagementsPage, noParams);
    expect(screen.getByText(/No vendor engagements yet/)).toBeInTheDocument();
    expect(api.listVendorEngagements).toHaveBeenCalled();
  });

  it("/vendor-engagements/new renders the intake form again", async () => {
    await renderPage(NewVendorEngagementPage, noParams);
    expect(screen.getByRole("heading", { name: "New engagement" })).toBeInTheDocument();
    expect(api.getVendors).toHaveBeenCalled();
  });
});

describe("OFF-PRODUCTION with the key absent — the ruled dev/test default keeps local dev usable", () => {
  it("/vendor-assurance renders (engine fails open the same way, so the menu is not dead locally)", async () => {
    setFlag("absent-nonprod");
    signedIn();
    await renderPage(VendorAssurancePage, {});
    expect(api.listVendorEngagements).toHaveBeenCalled();
  });
});
