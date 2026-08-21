/**
 * remediationSla.render.test.tsx — the remediation SLA settings section.
 *
 * WHAT THIS FILE PROTECTS: that the UI describes the engine that actually
 * exists. Three claims are easy to make by accident and expensive to be wrong
 * about:
 *
 *   CALENDAR DAYS. findingSlaPolicyRules.ts computes CURRENT_DATE + days.
 *   There is no business-day or holiday arithmetic anywhere in the platform, so
 *   an unqualified "days" would let an administrator assume working days and
 *   make every deadline they set materially longer than they intended.
 *
 *   PROSPECTIVE ONLY. The SLA is read when a finding is CREATED and never
 *   recomputed. A policy change that silently rewrote historical due dates
 *   would corrupt the overdue record an auditor relies on, so the UI says so
 *   rather than leaving it to be discovered.
 *
 *   NOT CONFIGURED IS A STATE. A null policy means no automatic deadline at
 *   all — a real operating condition, not an empty form.
 *
 * It also pins the thing most likely to break the OTHER section: the endpoint
 * requires cadence_by_rating on every write, so saving the SLA must carry the
 * cadence through or it would blank it.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// Typed to the real RESULT UNION, not inferred from the happy path: a mock
// that only knows { ok: true } cannot express the refusal case, and the
// refusal case is what the last test in this file is about.
const api = vi.hoisted(() => ({
  putRiskSettings: vi.fn(
    async (
      _cadence: Record<string, number>,
      _options?: { finding_sla_by_severity?: Record<string, number> | null }
    ): Promise<
      | { ok: true; settings: import("@/lib/api").RiskSettings }
      | { ok: false; error: string }
    > => ({ ok: true, settings: {} as import("@/lib/api").RiskSettings })
  ),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}));

import { RemediationSlaSection } from "../RemediationSlaSection";

const CADENCE = { Critical: 30, High: 60, Moderate: 90, Low: 180 };
const CONFIGURED = { Critical: 7, High: 14, Moderate: 30, Low: 90 };

const section = (props: Partial<Parameters<typeof RemediationSlaSection>[0]> = {}) =>
  render(
    <RemediationSlaSection
      initialSla={CONFIGURED}
      cadenceByRating={CADENCE}
      canEdit
      {...props}
    />
  );

const daysInput = (sev: string) =>
  screen.getByLabelText(new RegExp(`${sev} remediation days`, "i")) as HTMLInputElement;

beforeEach(() => {
  vi.clearAllMocks();
  api.putRiskSettings.mockResolvedValue({ ok: true, settings: {} as import("@/lib/api").RiskSettings });
});

describe("it says what the engine actually does", () => {
  it("labels the unit CALENDAR days, on every row", () => {
    section();

    // Exact match, not a regex: the intro paragraph also says "calendar days",
    // and this assertion is about the four ROW labels — the place an
    // administrator actually reads the unit while typing a number.
    expect(screen.getAllByText("calendar days")).toHaveLength(4);
  });

  it("says plainly that weekends and holidays count", () => {
    // The engine has no working-day arithmetic. Silence here would be a lie of
    // omission that changes every deadline the customer sets.
    section();

    expect(screen.getByText(/not working days/i)).toBeInTheDocument();
  });

  it("says the policy is prospective and never rewrites existing due dates", () => {
    section();

    expect(screen.getByText(/existing due dates are never rewritten/i)).toBeInTheDocument();
  });

  it("says a hand-set due date wins over the policy", () => {
    // The real precedence: findings.ts does `due_date ?? resolveSlaDueDate(...)`.
    section();

    expect(screen.getByText(/set by hand on an individual finding always wins/i)).toBeInTheDocument();
  });

  it("explains what these values govern", () => {
    section();

    expect(screen.getByText(/SLA Breached/)).toBeInTheDocument();
  });
});

describe("not configured is a state, not an empty form", () => {
  it("says so, and says what it means operationally", () => {
    section({ initialSla: null });

    expect(screen.getByText(/No remediation SLA is configured/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing can be overdue/i)).toBeInTheDocument();
  });

  it("offers to turn it on rather than to 'save'", () => {
    section({ initialSla: null });

    expect(screen.getByRole("button", { name: /Turn on remediation SLA/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Turn off$/i })).not.toBeInTheDocument();
  });

  it("prefills a suggestion without claiming it is a platform default", () => {
    section({ initialSla: null });

    expect(daysInput("Critical").value).toBe("7");
  });
});

describe("configuring", () => {
  it("shows the values currently in force", () => {
    section();

    expect(daysInput("Critical").value).toBe("7");
    expect(daysInput("High").value).toBe("14");
    expect(daysInput("Moderate").value).toBe("30");
    expect(daysInput("Low").value).toBe("90");
  });

  it("sends all four severities and CARRIES THE CADENCE THROUGH", async () => {
    // The endpoint requires cadence_by_rating on every write. Omitting it here
    // would blank the review-cadence policy as a side effect of saving an SLA.
    section();

    fireEvent.change(daysInput("High"), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: /Save SLA/i }));

    await waitFor(() => expect(api.putRiskSettings).toHaveBeenCalled());
    const [cadence, options] = api.putRiskSettings.mock.calls[0]!;
    expect(cadence).toEqual(CADENCE);
    expect(options?.finding_sla_by_severity).toEqual({
      Critical: 7, High: 10, Moderate: 30, Low: 90,
    });
  });

  it("confirms that the change is prospective", async () => {
    section();

    fireEvent.change(daysInput("Low"), { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: /Save SLA/i }));

    expect(await screen.findByText(/applies to findings created from now on/i)).toBeInTheDocument();
  });

  it("turning it off sends an explicit null — the engine's 'clear' signal", async () => {
    // Absent means "leave unchanged"; only an explicit null clears the policy.
    section();

    fireEvent.click(screen.getByRole("button", { name: /^Turn off$/i }));

    await waitFor(() => expect(api.putRiskSettings).toHaveBeenCalled());
    expect(api.putRiskSettings.mock.calls[0]![1]?.finding_sla_by_severity).toBeNull();
    expect(await screen.findByText(/no automatic due date/i)).toBeInTheDocument();
  });
});

describe("bounds match the server's", () => {
  it("refuses zero", () => {
    section();

    fireEvent.change(daysInput("Critical"), { target: { value: "0" } });

    expect(screen.getByText(/between 1 and 3650/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Save SLA/i })).toBeDisabled();
  });

  it("refuses more than ten years", () => {
    section();

    fireEvent.change(daysInput("Low"), { target: { value: "3651" } });

    expect(screen.getByRole("button", { name: /Save SLA/i })).toBeDisabled();
  });

  it("refuses a fraction of a day", () => {
    section();

    fireEvent.change(daysInput("High"), { target: { value: "7.5" } });

    expect(screen.getByRole("button", { name: /Save SLA/i })).toBeDisabled();
  });

  it("does not send anything while the form is invalid", () => {
    section();

    fireEvent.change(daysInput("High"), { target: { value: "-3" } });
    fireEvent.click(screen.getByRole("button", { name: /Save SLA/i }));

    expect(api.putRiskSettings).not.toHaveBeenCalled();
  });
});

describe("non-admins", () => {
  it("see the policy but cannot edit it", () => {
    section({ canEdit: false });

    expect(daysInput("Critical")).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Save SLA/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Only organization admins/i)).toBeInTheDocument();
  });
});

describe("failure is surfaced, not swallowed", () => {
  it("explains a server refusal in the admin's terms", async () => {
    api.putRiskSettings.mockResolvedValue({ ok: false, error: "http_403" });
    section();

    fireEvent.change(daysInput("High"), { target: { value: "21" } });
    fireEvent.click(screen.getByRole("button", { name: /Save SLA/i }));

    expect(await screen.findByText(/Only organization admins can change/i)).toBeInTheDocument();
  });
});
