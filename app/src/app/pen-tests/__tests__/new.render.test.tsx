/**
 * /pen-tests/new — the create-form render contract (PEN-1).
 *
 * The form is deliberately as small as the table behind it: name required,
 * firm/dates/report reference optional. What these tests pin: the server gate
 * (a sub-platform user gets a redirect, not a shell whose submit would 403),
 * the required marking on name, and that a server-action error renders as a
 * sentence instead of vanishing.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderPage, expectRedirect, signedIn, hrefOf } from "@/test/harness";

const actions = vi.hoisted(() => ({
  createPenTest: vi.fn(),
}));

vi.mock("../new/actions", () => actions);

import NewPenTestPage from "../new/page";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

beforeEach(() => {
  // TWO-CONTROL MODEL: these pages are gated by ACTIVATION as well as
  // entitlement. The cases below are the render contract with the
  // capability ON; the flag-off case lives in its own describe.
  process.env["SECURELOGIC_PEN_TEST_ENABLED"] = "true";
  vi.clearAllMocks();
  signedIn();
});

describe("/pen-tests/new — entitlement gate", () => {
  it("redirects a signed-out caller to /login", async () => {
    signedIn({ jwtToken: undefined, apiKey: undefined });
    expect(await expectRedirect(NewPenTestPage, {})).toBe("/login");
  });

  it("redirects a sub-platform caller to /dashboard", async () => {
    signedIn({ entitlementLevel: "free" });
    expect(await expectRedirect(NewPenTestPage, {})).toBe("/dashboard");
  });
});

describe("/pen-tests/new — the form", () => {
  it("renders the provenance fields, with only Name required", async () => {
    const { container } = await renderPage(NewPenTestPage, {});

    const name = container.querySelector("input[name='name']") as HTMLInputElement;
    expect(name).not.toBeNull();
    expect(name.required).toBe(true);

    for (const field of ["provider", "started_on", "ended_on", "report_reference"]) {
      const input = container.querySelector(`input[name='${field}']`) as HTMLInputElement;
      expect(input, `${field} input`).not.toBeNull();
      expect(input.required, `${field} must be optional`).toBe(false);
    }
  });

  it("offers a way back that does not submit anything", async () => {
    const { container } = await renderPage(NewPenTestPage, {});

    expect(hrefOf(container, "Cancel")).toBe("/pen-tests");
    expect(hrefOf(container, "Pen Tests")).toBe("/pen-tests");
  });

  it("a server-action error renders as a sentence instead of vanishing", async () => {
    actions.createPenTest.mockResolvedValue({ error: "The end date is before the start date" });
    const { container } = await renderPage(NewPenTestPage, {});

    const form = container.querySelector("form") as HTMLFormElement;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByText("The end date is before the start date")).toBeInTheDocument();
    });
    expect(actions.createPenTest).toHaveBeenCalledTimes(1);
  });

  it("success is a redirect owned by the action — the form records nothing locally", async () => {
    actions.createPenTest.mockResolvedValue(undefined);
    const { container } = await renderPage(NewPenTestPage, {});

    fireEvent.submit(container.querySelector("form") as HTMLFormElement);

    await waitFor(() => {
      expect(actions.createPenTest).toHaveBeenCalledTimes(1);
    });
    // No error rendered, no local success state invented.
    expect(container.querySelector("[class*='rounded-lg'][style*='239,68,68']")).toBeNull();
  });
});
