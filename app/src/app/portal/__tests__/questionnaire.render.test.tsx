/**
 * /portal/questionnaire — render + save contract.
 *
 * Rendered inside the real PortalShell so the engagement read, the 401
 * handling, and the header all run for real; only fetch is mocked. Pins:
 *  - each question shows reference, title, required badge, and the rule trace
 *    the engine returns (why_we_are_asking);
 *  - selecting an answer PUTs the engine's exact vocabulary value and shows
 *    the optimistic selection;
 *  - a failed save rolls the selection back and surfaces the engine message;
 *  - a submitted engagement renders read-only;
 *  - a dead session shows the uniform "secure link required" state (no login
 *    form on this surface).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import PortalShell from "../PortalShell";
import QuestionnairePage from "../questionnaire/page";

const ENGAGEMENT = {
  organization_name: "Meridian Health",
  vendor_name: "Acme Corp",
  title: "Annual security assessment",
  status: "in_progress",
  due_date: null,
  accepting_responses: true,
};

const QUESTIONS = [
  {
    requirement_id: "req-1",
    reference: "AC-2",
    title: "User access reviews are performed quarterly",
    guidance: "Describe how access recertification is done.",
    depth: "full",
    mandatory: true,
    why_we_are_asking: [
      {
        rule_id: "S2-access-control",
        rule_family: "S2",
        rationale: "This vendor processes customer PII, so access-control requirements apply.",
      },
    ],
    answer: null,
    notes: null,
  },
  {
    requirement_id: "req-2",
    reference: "IR-1",
    title: "An incident response plan exists and is tested",
    guidance: null,
    depth: "attest",
    mandatory: false,
    why_we_are_asking: [],
    answer: "pass",
    notes: "Tested annually.",
  },
];

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
          body: { questions: QUESTIONS },
        }),
      } as Record<string, Handler>)[key];
    if (!handler) throw new Error(`Unexpected fetch in test: ${key}`);
    const { status, body } = handler(init);
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderQuestionnaire() {
  return render(
    <PortalShell>
      <QuestionnairePage />
    </PortalShell>
  );
}

describe("portal questionnaire", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders questions with reference, required badge, rule trace, and answer options", async () => {
    stubPortalFetch();
    renderQuestionnaire();

    expect(
      await screen.findByText("User access reviews are performed quarterly")
    ).toBeInTheDocument();
    expect(screen.getByText("AC-2")).toBeInTheDocument();
    expect(screen.getByText("Required")).toBeInTheDocument();
    // The "why we're asking" trace the engine returns, verbatim.
    expect(
      screen.getByText(/processes customer PII, so access-control requirements apply/i)
    ).toBeInTheDocument();
    // The shell header names who is asking.
    expect(screen.getAllByText(/Meridian Health/).length).toBeGreaterThan(0);
    // Existing answer is reflected.
    const inPlaceButtons = screen.getAllByRole("button", { name: "In place" });
    expect(inPlaceButtons).toHaveLength(2);
    expect(inPlaceButtons[1]).toHaveAttribute("aria-pressed", "true");
    // 1 of 2 answered.
    expect(screen.getByText("1 of 2 answered")).toBeInTheDocument();
  });

  it("saves an answer with the engine's exact vocabulary value", async () => {
    const put = vi.fn<Handler>(() => ({ status: 200, body: { ok: true } }));
    const fetchMock = stubPortalFetch({ "PUT /api/vendor-portal/questions/req-1": put });
    renderQuestionnaire();

    const partial = (
      await screen.findAllByRole("button", { name: "Partially in place" })
    )[0];
    fireEvent.click(partial);

    await waitFor(() => {
      expect(put).toHaveBeenCalledTimes(1);
    });
    const putCall = fetchMock.mock.calls.find(
      (c) => (c[1] as RequestInit | undefined)?.method === "PUT"
    )!;
    expect(String(putCall[0])).toBe("/api/vendor-portal/questions/req-1");
    expect(JSON.parse(String((putCall[1] as RequestInit).body))).toEqual({
      answer: "partial",
      notes: null,
    });
    await waitFor(() => {
      expect(partial).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByText("Saved")).toBeInTheDocument();
    });
  });

  it("rolls the selection back and shows the engine message when a save fails", async () => {
    stubPortalFetch({
      "PUT /api/vendor-portal/questions/req-1": () => ({
        status: 400,
        body: {
          error: "invalid_answer",
          message: "Choose one of the available answers. Notes are optional and supplement it.",
        },
      }),
    });
    renderQuestionnaire();

    const notInPlace = (await screen.findAllByRole("button", { name: "Not in place" }))[0];
    fireEvent.click(notInPlace);

    expect(
      await screen.findByText(/choose one of the available answers/i)
    ).toBeInTheDocument();
    // Rolled back: the failed selection is no longer shown as chosen.
    expect(notInPlace).toHaveAttribute("aria-pressed", "false");
  });

  it("locks the form and explains why once the engagement is submitted", async () => {
    stubPortalFetch({
      "GET /api/vendor-portal/engagement": () => ({
        status: 200,
        body: { ...ENGAGEMENT, status: "submitted", accepting_responses: false },
      }),
    });
    renderQuestionnaire();

    expect(
      await screen.findByText(/has been submitted and is read-only/i)
    ).toBeInTheDocument();
    const answerButtons = screen.getAllByRole("button", { name: "In place" });
    for (const b of answerButtons) expect(b).toBeDisabled();
  });

  it("shows the uniform secure-link state when the session is gone (401)", async () => {
    stubPortalFetch({
      "GET /api/vendor-portal/engagement": () => ({
        status: 401,
        body: { error: "portal_session_invalid" },
      }),
    });
    renderQuestionnaire();

    expect(await screen.findByText(/secure link required/i)).toBeInTheDocument();
    // No login form on this surface — the emailed link is the only way in.
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(screen.getByText(/open the link from your invitation email/i)).toBeInTheDocument();
  });
});
