/**
 * /portal/review — pre-submit review contract.
 *
 * Pins:
 *  - unanswered REQUIRED questions are called out by reference and block the
 *    submit button (mirrors the engine's 422 `incomplete` guard);
 *  - with everything answered, submit POSTs /submit and navigates to
 *    /portal/done;
 *  - the engine's blocking errors (422) surface inline, verbatim;
 *  - an already-submitted engagement shows the submitted state, not a button.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { clientRouter } from "@/test/harness";
import PortalShell from "../PortalShell";
import ReviewPage from "../review/page";

const ENGAGEMENT = {
  organization_name: "Meridian Health",
  vendor_name: "Acme Corp",
  title: "Annual security assessment",
  status: "in_progress",
  due_date: null,
  accepting_responses: true,
};

const UNANSWERED_REQUIRED = {
  requirement_id: "req-1",
  reference: "AC-2",
  title: "User access reviews are performed quarterly",
  guidance: null,
  depth: "full",
  mandatory: true,
  why_we_are_asking: [],
  answer: null,
  notes: null,
};

const ANSWERED = {
  requirement_id: "req-2",
  reference: "IR-1",
  title: "An incident response plan exists and is tested",
  guidance: null,
  depth: "attest",
  mandatory: true,
  why_we_are_asking: [],
  answer: "pass",
  notes: null,
};

type Handler = (init?: RequestInit) => { status: number; body: unknown };

function stubPortalFetch(overrides: Partial<Record<string, Handler>> = {}) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const key = `${method} ${String(url)}`;
    const handler =
      overrides[key] ??
      ({
        "GET /api/vendor-portal/engagement": () => ({ status: 200, body: ENGAGEMENT }),
        "GET /api/vendor-portal/questions": () => ({
          status: 200,
          body: { questions: [ANSWERED] },
        }),
      } as Record<string, Handler>)[key];
    if (!handler) throw new Error(`Unexpected fetch in test: ${key}`);
    const { status, body } = handler(init);
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderReview() {
  return render(
    <PortalShell>
      <ReviewPage />
    </PortalShell>
  );
}

describe("portal review & submit", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("calls out unanswered required questions and blocks submission", async () => {
    stubPortalFetch({
      "GET /api/vendor-portal/questions": () => ({
        status: 200,
        body: { questions: [UNANSWERED_REQUIRED, ANSWERED] },
      }),
    });
    renderReview();

    expect(
      await screen.findByText(/1 required question still unanswered/i)
    ).toBeInTheDocument();
    expect(screen.getByText("AC-2")).toBeInTheDocument();
    expect(
      screen.getByText("User access reviews are performed quarterly")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /submit responses/i })).toBeDisabled();
    // A path back to fix it — no dead ends.
    expect(
      screen.getByRole("link", { name: /go to the questionnaire/i })
    ).toHaveAttribute("href", "/portal/questionnaire");
  });

  it("submits and navigates to /portal/done on success", async () => {
    const submit = vi.fn<Handler>(() => ({
      status: 200,
      body: { ok: true, status: "submitted" },
    }));
    stubPortalFetch({ "POST /api/vendor-portal/submit": submit });
    renderReview();

    const button = await screen.findByRole("button", { name: /submit responses/i });
    expect(button).toBeEnabled();
    expect(screen.getByText(/all required questions answered/i)).toBeInTheDocument();
    fireEvent.click(button);

    await waitFor(() => {
      expect(submit).toHaveBeenCalledTimes(1);
      expect(clientRouter.push).toHaveBeenCalledWith("/portal/done");
    });
  });

  it("surfaces the engine's 422 incomplete error inline", async () => {
    stubPortalFetch({
      "POST /api/vendor-portal/submit": () => ({
        status: 422,
        body: {
          error: "incomplete",
          unanswered_required: 2,
          message: "2 required question(s) still need an answer.",
        },
      }),
    });
    renderReview();

    fireEvent.click(await screen.findByRole("button", { name: /submit responses/i }));

    expect(
      await screen.findByText(/2 required question\(s\) still need an answer/i)
    ).toBeInTheDocument();
    expect(clientRouter.push).not.toHaveBeenCalled();
  });

  it("shows the submitted state instead of a submit button once responses are closed", async () => {
    stubPortalFetch({
      "GET /api/vendor-portal/engagement": () => ({
        status: 200,
        body: { ...ENGAGEMENT, status: "submitted", accepting_responses: false },
      }),
    });
    renderReview();

    expect(await screen.findByText(/already submitted/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /submit responses/i })
    ).not.toBeInTheDocument();
  });
});
