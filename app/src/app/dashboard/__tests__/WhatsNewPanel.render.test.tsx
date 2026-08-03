/**
 * WhatsNewPanel — the gate matrix.
 *
 * The panel announces that surfaces moved INTO the navigation. Under the legacy
 * IA they are not there, so a panel that leaks past its flag would send
 * customers hunting for menu items that do not exist. These tests pin that the
 * panel's lifecycle is identical to the change it describes — including that it
 * disappears on rollback.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { WhatsNewPanel } from "../WhatsNewPanel";
import { WAVE_1_RELEASE } from "@/lib/whatsNew";
import type { AuthMeResponse } from "@/lib/api";

const FLAG = "SECURELOGIC_RISK_WORKSPACE_ENABLED";
const original = process.env[FLAG];

function authMe(dismissed: string[] = []): AuthMeResponse {
  return {
    email: "analyst@example.com",
    name: "Analyst",
    role: "analyst",
    organizationId: "org-1",
    organizationName: "Example Org",
    entitlementLevel: "platform",
    billingActive: true,
    dismissedBannerKeys: dismissed,
  } as AuthMeResponse;
}

beforeEach(() => {
  process.env[FLAG] = "true";
});

afterEach(() => {
  if (original === undefined) delete process.env[FLAG];
  else process.env[FLAG] = original;
  vi.clearAllMocks();
});

describe("WhatsNewPanel", () => {
  it("renders the release when the flag is on and nothing is dismissed", () => {
    render(<WhatsNewPanel authMe={authMe()} />);
    expect(screen.getByText(WAVE_1_RELEASE.headline)).toBeTruthy();
    // Every item's "why" is present — the panel's whole reason to exist.
    for (const item of WAVE_1_RELEASE.items) {
      expect(screen.getByText(item.why)).toBeTruthy();
    }
  });

  it("offers BOTH a permanent dismiss and a show-later", () => {
    render(<WhatsNewPanel authMe={authMe()} />);
    expect(screen.getByRole("button", { name: "Got it" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show later" })).toBeTruthy();
  });

  it("renders nothing when the flag is off (rollback / pre-promotion)", () => {
    process.env[FLAG] = "false";
    const { container } = render(<WhatsNewPanel authMe={authMe()} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when the flag is absent entirely", () => {
    delete process.env[FLAG];
    const { container } = render(<WhatsNewPanel authMe={authMe()} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing once the user has dismissed it", () => {
    const { container } = render(
      <WhatsNewPanel authMe={authMe([WAVE_1_RELEASE.bannerKey])} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for a legacy API-key session with no per-user identity", () => {
    // Nothing to dismiss against — withheld rather than shown un-dismissably.
    const { container } = render(<WhatsNewPanel authMe={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("is unaffected by an unrelated dismissed banner key", () => {
    render(<WhatsNewPanel authMe={authMe(["industry-templates-banner"])} />);
    expect(screen.getByText(WAVE_1_RELEASE.headline)).toBeTruthy();
  });
});
