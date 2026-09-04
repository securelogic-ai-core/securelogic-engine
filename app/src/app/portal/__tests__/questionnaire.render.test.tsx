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
 *    form on this surface);
 *  - WA-1: a negative answer prompts for the explanation the submit gate will
 *    require, and evidence can be attached AT the question.
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
    evidence_policy: "optional",
    evidence_count: 0,
    explanation_required: null,
    evidence_required: null,
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
    evidence_policy: "optional",
    evidence_count: 0,
    explanation_required: false,
    evidence_required: false,
  },
];

/** One artifact already attached to req-1, for the per-question list. */
const EVIDENCE = [
  {
    id: "ev-1",
    title: "Access review Q1",
    filename: "access-review-q1.pdf",
    byte_size: 1024,
    requirement_id: "req-1",
    requirement_reference: "AC-2",
    uploaded_at: "2026-09-01T00:00:00.000Z",
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
        // WA-1: the questionnaire now reads attachments so it can show them
        // beside the question they support.
        "GET /api/vendor-portal/evidence": () => ({
          status: 200,
          body: { files: EVIDENCE, accepting_uploads: true },
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

  it("prompts for the explanation the moment a negative answer is chosen (WA-1)", async () => {
    stubPortalFetch({
      "PUT /api/vendor-portal/questions/req-1": () => ({ status: 200, body: { ok: true } }),
    });
    renderQuestionnaire();

    // Before answering, nothing is demanded — a form that opens covered in
    // warnings for questions nobody has touched is noise, not guidance.
    await screen.findAllByRole("button", { name: "Partially in place" });
    expect(screen.queryByText(/an explanation is required/i)).not.toBeInTheDocument();

    fireEvent.click((await screen.findAllByRole("button", { name: "Partially in place" }))[0]!);

    // The prompt tracks the OPTIMISTIC answer, so it appears on the click
    // rather than after the next read of /questions.
    expect(
      await screen.findByText(/an explanation is required before this questionnaire can be submitted/i)
    ).toBeInTheDocument();
    expect(screen.getAllByText(/explanation \(required\)/i).length).toBeGreaterThan(0);
    // The placeholder is answer-specific, not a generic "add notes".
    expect(
      screen.getByPlaceholderText(/describe what is in place and what is not/i)
    ).toBeInTheDocument();
  });

  it("clears the explanation prompt once the vendor types one (WA-1)", async () => {
    stubPortalFetch({
      "PUT /api/vendor-portal/questions/req-1": () => ({ status: 200, body: { ok: true } }),
    });
    renderQuestionnaire();

    fireEvent.click((await screen.findAllByRole("button", { name: "Not in place" }))[0]!);
    expect(await screen.findByText(/an explanation is required/i)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/explain why this is not in place/i), {
      target: { value: "No formal process yet; scheduled for Q3." },
    });

    await waitFor(() => {
      expect(screen.queryByText(/an explanation is required/i)).not.toBeInTheDocument();
    });
  });

  it("shows evidence attached to a question, at the question (WA-1)", async () => {
    stubPortalFetch();
    renderQuestionnaire();

    // req-1's artifact renders beside req-1 — the whole point of WA-1 is that
    // evidence lives where the question that needs it lives.
    expect(await screen.findByText("access-review-q1.pdf")).toBeInTheDocument();
    expect(screen.getByLabelText("Attach evidence for req-1")).toBeInTheDocument();
    expect(screen.getByLabelText("Attach evidence for req-2")).toBeInTheDocument();
  });

  it("posts an attachment to the canonical endpoint with its requirement (WA-1)", async () => {
    const upload = vi.fn<Handler>(() => ({ status: 201, body: { ok: true } }));
    const fetchMock = stubPortalFetch({ "POST /api/vendor-portal/evidence": upload });
    renderQuestionnaire();

    const input = (await screen.findByLabelText("Attach evidence for req-1")) as HTMLInputElement;
    const file = new File(["%PDF-1.4 test"], "soc2.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(upload).toHaveBeenCalledTimes(1);
    });
    const call = fetchMock.mock.calls.find(
      (c) => (c[1] as RequestInit | undefined)?.method === "POST"
    )!;
    // The SAME canonical route the library page posts to — no second evidence
    // model, no second storage path.
    expect(String(call[0])).toBe("/api/vendor-portal/evidence");
    const form = (call[1] as RequestInit).body as FormData;
    expect(form.get("requirement_id")).toBe("req-1");
    expect((form.get("file") as File).name).toBe("soc2.pdf");
  });

  it("offers no attachment control once the questionnaire is read-only (WA-1)", async () => {
    stubPortalFetch({
      "GET /api/vendor-portal/engagement": () => ({
        status: 200,
        body: { ...ENGAGEMENT, status: "submitted", accepting_responses: false },
      }),
    });
    renderQuestionnaire();

    // Same gate as the answers: isPortalRespondable governs both, so they must
    // close together.
    await screen.findByText("access-review-q1.pdf");
    expect(screen.queryByLabelText("Attach evidence for req-1")).not.toBeInTheDocument();
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
