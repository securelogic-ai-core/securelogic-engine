/**
 * askConversations.render.test.tsx — Ask A3 multi-turn UI.
 *
 * What must hold:
 *   1. The caller's threads render (titles + relative activity) once the list
 *      read returns them, with a "New conversation" affordance.
 *   2. Selecting a thread loads and renders its transcript.
 *   3. The composer continues the SELECTED thread — conversation_id is passed
 *      to the ask action — and a fresh ask adopts the id the engine returns.
 *   4. Assistant-turn citations render from the STORED claims structure
 *      (engine claims.ts shape: claim_class + citations with tool_name /
 *      object_type / field) — never recomputed.
 *   5. Graceful degradation: when conversation reads return null/empty and the
 *      ask response carries no conversation_id (snapshot-path engines), the
 *      page behaves exactly like single-shot Ask — no sidebar, no errors.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AskClient } from "../AskClient";
import {
  askAction,
  listConversationsAction,
  getConversationAction,
} from "../actions";
import type { AskConversationMessage } from "@/lib/api";

// The server actions are "use server" — jsdom cannot cross that boundary.
// These tests assert what is RENDERED and what the client PASSES to them.
vi.mock("../actions", () => ({
  askAction: vi.fn(),
  listConversationsAction: vi.fn(),
  getConversationAction: vi.fn(),
}));

const mockAsk  = vi.mocked(askAction);
const mockList = vi.mocked(listConversationsAction);
const mockGet  = vi.mocked(getConversationAction);

// ── Fixtures ────────────────────────────────────────────────────────────────

const CONVERSATIONS = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    title: "What are my critical findings?",
    mode: "text" as const,
    last_message_at: new Date(Date.now() - 5 * 60_000).toISOString(),
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    title: null,
    mode: "voice" as const,
    last_message_at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  },
];

/** Stored-shape claims (src/api/lib/ask/claims.ts Claim[]), as loadMessages returns them. */
const CLAIMS_FIXTURE = [
  {
    text: "3 findings are currently critical and active.",
    claim_class: "observed",
    citations: [
      {
        invocation_index: 0,
        tool_name: "list_findings",
        object_type: "finding",
        field: "critical_active",
        value: 3,
      },
    ],
  },
  {
    text: "Your remediation backlog is concentrated in one domain.",
    claim_class: "inference",
    citations: [
      { invocation_index: 0, tool_name: "list_findings" },
    ],
    derived_from: [0],
  },
];

const THREAD_DETAIL = {
  conversation: CONVERSATIONS[0]!,
  messages: [
    {
      id: "m-1",
      role: "user" as const,
      content: "What are my critical findings?",
      claims: null,
      created_at: "2026-08-13T10:00:00Z",
    },
    {
      id: "m-2",
      role: "assistant" as const,
      content: "You have 3 critical active findings.",
      claims: CLAIMS_FIXTURE,
      created_at: "2026-08-13T10:00:05Z",
    },
  ],
};

/** A tool-path ask response continuing thread c1. */
function toolPathResponse(conversationId: string) {
  return {
    ok: true as const,
    data: {
      answer: "The most severe one is the unpatched VPN appliance.",
      question: "Which is most severe?",
      conversation_id: conversationId,
      context_used: { retrieval: "tools" as const, tool_calls: 2, tools_denied: 0, complete: true },
      provenance: {
        verified: true,
        claims: [
          {
            text: "The most severe finding is the unpatched VPN appliance.",
            claim_class: "observed",
            // POST-response citation spelling: `tool`, not `tool_name` (ask.ts maps it).
            citations: [{ tool: "list_findings", object_type: "finding", object_id: "f-42" }],
          },
        ],
      },
    },
  };
}

/** A snapshot-path ask response — no conversation_id, snapshot context_used. */
const SNAPSHOT_RESPONSE = {
  ok: true as const,
  data: {
    answer: "Your posture is stable.",
    question: "How is my posture?",
    context_used: {
      posture_score: 71,
      findings_count: 12,
      risks_count: 4,
      vendors_count: 9,
      as_of: "2026-08-12",
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ── 1. Conversation list ────────────────────────────────────────────────────

describe("conversation list", () => {
  it("renders threads with titles, relative activity, and a New conversation affordance", async () => {
    mockList.mockResolvedValue({ conversations: CONVERSATIONS });
    render(<AskClient />);

    expect(await screen.findByText("What are my critical findings?")).toBeInTheDocument();
    expect(screen.getByText("Untitled conversation")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Conversations" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /New conversation/ })).toBeInTheDocument();
    // Relative last-activity, engine-ordered newest first.
    expect(screen.getByText(/5m ago/)).toBeInTheDocument();
    expect(screen.getByText(/voice · 3h ago/)).toBeInTheDocument();
  });
});

// ── 2. Selecting a thread loads its transcript ──────────────────────────────

describe("thread selection", () => {
  it("loads and renders the selected thread's messages", async () => {
    mockList.mockResolvedValue({ conversations: CONVERSATIONS });
    mockGet.mockResolvedValue(THREAD_DETAIL);
    render(<AskClient />);

    fireEvent.click(await screen.findByText("What are my critical findings?"));

    expect(await screen.findByText("You have 3 critical active findings.")).toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledWith(CONVERSATIONS[0]!.id);
    // Both roles labelled.
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.getByText("SecureLogic")).toBeInTheDocument();
  });

  it("drops a vanished thread and maps conversation_not_found", async () => {
    mockList.mockResolvedValue({ conversations: CONVERSATIONS });
    mockGet.mockResolvedValue(null);
    render(<AskClient />);

    fireEvent.click(await screen.findByText("What are my critical findings?"));

    expect(
      await screen.findByText("That conversation is no longer available.")
    ).toBeInTheDocument();
    expect(screen.queryByText("What are my critical findings?")).not.toBeInTheDocument();
  });
});

// ── 3. Composer continues the selected thread ───────────────────────────────

describe("composer", () => {
  it("passes the selected conversation_id to the ask action", async () => {
    mockList.mockResolvedValue({ conversations: CONVERSATIONS });
    mockGet.mockResolvedValue(THREAD_DETAIL);
    mockAsk.mockResolvedValue(toolPathResponse(CONVERSATIONS[0]!.id));
    render(<AskClient />);

    fireEvent.click(await screen.findByText("What are my critical findings?"));
    await screen.findByText("You have 3 critical active findings.");

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Which is most severe?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask SecureLogic" }));

    expect(
      await screen.findByText("The most severe one is the unpatched VPN appliance.")
    ).toBeInTheDocument();
    expect(mockAsk).toHaveBeenCalledWith("Which is most severe?", CONVERSATIONS[0]!.id);
    // The prior transcript is still there — this is a continuation, not a reset.
    expect(screen.getByText("You have 3 critical active findings.")).toBeInTheDocument();
  });

  it("starts a new thread with no selection and adopts the returned conversation_id", async () => {
    // No pre-existing threads: first list read returns null (engine without
    // the routes, or nothing yet).
    mockList.mockResolvedValueOnce(null);
    const newId = "33333333-3333-4333-8333-333333333333";
    mockAsk.mockResolvedValue(toolPathResponse(newId));
    mockList.mockResolvedValue({
      conversations: [
        { id: newId, title: "Which is most severe?", mode: "text", last_message_at: new Date().toISOString() },
      ],
    });
    render(<AskClient />);

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Which is most severe?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask SecureLogic" }));

    // The answer lands as a transcript turn and the new thread appears in the list.
    expect(
      await screen.findByText("The most severe one is the unpatched VPN appliance.")
    ).toBeInTheDocument();
    expect(mockAsk).toHaveBeenCalledWith("Which is most severe?", null);
    expect(await screen.findByRole("navigation", { name: "Conversations" })).toBeInTheDocument();

    // The NEXT ask continues the adopted thread.
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "And the second?" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask SecureLogic" }));
    await waitFor(() =>
      expect(mockAsk).toHaveBeenLastCalledWith("And the second?", newId)
    );
  });
});

// ── 4. Citations render from the stored claims structure ────────────────────

describe("provenance rendering", () => {
  it("renders claim classes and what each claim was verified against, from the claims fixture", async () => {
    mockList.mockResolvedValue({ conversations: CONVERSATIONS });
    mockGet.mockResolvedValue(THREAD_DETAIL);
    render(<AskClient />);

    fireEvent.click(await screen.findByText("What are my critical findings?"));
    await screen.findByText("You have 3 critical active findings.");

    // Compact, expandable summary.
    expect(screen.getByText("Provenance · 2 claims")).toBeInTheDocument();
    // Claim classes from the stored structure.
    expect(screen.getByText("observed")).toBeInTheDocument();
    expect(screen.getByText("inference")).toBeInTheDocument();
    // The citation line references the tool / object / field the claim was
    // verified against — rendered from the record, not recomputed.
    expect(
      screen.getByText(/Verified against:.*list_findings · finding · critical_active/)
    ).toBeInTheDocument();
    // Inference is labelled as reasoning, not as a verified system value.
    expect(screen.getByText(/Reasoned from:.*list_findings/)).toBeInTheDocument();
  });

  it("renders no provenance block when an assistant message has null claims", async () => {
    mockList.mockResolvedValue({ conversations: CONVERSATIONS });
    mockGet.mockResolvedValue({
      conversation: CONVERSATIONS[0]!,
      messages: [
        THREAD_DETAIL.messages[0]!,
        { ...THREAD_DETAIL.messages[1]!, claims: null },
      ],
    });
    render(<AskClient />);

    fireEvent.click(await screen.findByText("What are my critical findings?"));
    await screen.findByText("You have 3 critical active findings.");
    expect(screen.queryByText(/Provenance ·/)).not.toBeInTheDocument();
  });
});

// ── 4b. Recent-thread rail truncation ───────────────────────────────────────
//
// The rail shows the five most recent threads and hides the rest behind "View
// all conversations". It is a DISPLAY limit and the tests below hold it to
// that: every thread the engine returned stays present, selectable, and — once
// opened — visible in the rail even after collapsing. A truncation that could
// strand a conversation would be data loss wearing a layout change's clothes.

/** N threads, newest first, in the engine's own ordering. */
function manyConversations(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `${i}${i}${i}${i}${i}${i}${i}${i}-1111-4111-8111-111111111111`,
    title: `Thread ${i + 1}`,
    mode: "text" as const,
    last_message_at: new Date(Date.now() - (i + 1) * 60_000).toISOString(),
  }));
}

const EIGHT = manyConversations(8);

describe("conversation rail truncation", () => {
  it("shows the five most recent and offers the rest, counted honestly", async () => {
    mockList.mockResolvedValue({ conversations: EIGHT });
    render(<AskClient />);

    expect(await screen.findByText("Thread 1")).toBeInTheDocument();
    expect(screen.getByText("Thread 5")).toBeInTheDocument();
    expect(screen.queryByText("Thread 6")).not.toBeInTheDocument();
    expect(screen.queryByText("Thread 8")).not.toBeInTheDocument();

    // The count names the FULL list, not the hidden remainder — the control
    // promises what it actually reveals.
    expect(
      screen.getByRole("button", { name: "View all conversations (8)" })
    ).toBeInTheDocument();
  });

  it("reveals every thread in place, and collapses back", async () => {
    mockList.mockResolvedValue({ conversations: EIGHT });
    render(<AskClient />);

    fireEvent.click(await screen.findByRole("button", { name: /View all conversations/ }));

    for (const c of EIGHT) {
      expect(screen.getByText(c.title)).toBeInTheDocument();
    }
    const collapse = screen.getByRole("button", { name: "Show recent only" });
    expect(collapse).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(collapse);
    expect(screen.queryByText("Thread 8")).not.toBeInTheDocument();
  });

  it("renders no control when nothing is hidden", async () => {
    // Exactly at the limit: a caller with five threads must not see a control
    // promising a longer list than exists.
    mockList.mockResolvedValue({ conversations: manyConversations(5) });
    render(<AskClient />);

    expect(await screen.findByText("Thread 5")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /View all conversations/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Show recent only/ })).not.toBeInTheDocument();
  });

  it("keeps an older SELECTED thread in the rail after collapsing", async () => {
    // Expand, open thread 8, collapse. The transcript is on screen, so the rail
    // must still show which conversation it belongs to — otherwise the page
    // displays an active conversation with nothing highlighted.
    mockList.mockResolvedValue({ conversations: EIGHT });
    mockGet.mockResolvedValue({
      conversation: EIGHT[7]!,
      messages: THREAD_DETAIL.messages,
    });
    render(<AskClient />);

    fireEvent.click(await screen.findByRole("button", { name: /View all conversations/ }));
    fireEvent.click(screen.getByText("Thread 8"));
    expect(await screen.findByText("You have 3 critical active findings.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show recent only" }));

    // Still listed, still loaded, and the recent five did not lose a slot to it.
    expect(screen.getByText("Thread 8")).toBeInTheDocument();
    expect(screen.getByText("Thread 1")).toBeInTheDocument();
    expect(screen.getByText("Thread 5")).toBeInTheDocument();
    expect(screen.queryByText("Thread 7")).not.toBeInTheDocument();
  });
});

// ── 5. Graceful single-shot degradation ─────────────────────────────────────

describe("single-shot degradation", () => {
  it("behaves exactly like single-shot Ask when the list is empty and the response has no conversation_id", async () => {
    mockList.mockResolvedValue({ conversations: [] });
    mockAsk.mockResolvedValue(SNAPSHOT_RESPONSE);
    render(<AskClient />);

    // No sidebar, no dead states.
    expect(screen.queryByRole("navigation", { name: "Conversations" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "How is my posture?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask SecureLogic" }));

    // Classic answer card with the snapshot context caption.
    expect(await screen.findByText("Your posture is stable.")).toBeInTheDocument();
    expect(
      screen.getByText(/Posture score 71 · 12 active findings · 4 risks/)
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ask another question/ })).toBeInTheDocument();
    // Still no sidebar after the answer — no conversation_id means no threads.
    expect(screen.queryByRole("navigation", { name: "Conversations" })).not.toBeInTheDocument();
    // No transcript bubbles either.
    expect(screen.queryByText("SecureLogic", { selector: "span" })).not.toBeInTheDocument();
  });

  it("stays single-shot when the conversation list read fails outright", async () => {
    mockList.mockResolvedValue(null);
    mockAsk.mockResolvedValue(SNAPSHOT_RESPONSE);
    render(<AskClient />);

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "How is my posture?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask SecureLogic" }));

    expect(await screen.findByText("Your posture is stable.")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Conversations" })).not.toBeInTheDocument();
  });
});

/**
 * Deferred provenance — the lifecycle must be visible, and honest.
 *
 * A long answer is delivered before its citations exist, so the UI carries an
 * obligation it did not have when every answer was decomposed inline: it must
 * distinguish "citations are coming", "citations are incomplete", and "nobody
 * verified this" from each other AND from a clean, fully-cited answer. Showing
 * a bare uncited answer for any of them is the one unacceptable rendering.
 */
describe("provenance lifecycle rendering", () => {
  // Typed to the real contract rather than `string | null`: a widened string is
  // not assignable to AskConversationMessage["provenance_status"], and typing it
  // loosely here would let a misspelled status ("complet") pass the type check
  // and fail only at assertion time.
  const turn = (
    provenance_status: AskConversationMessage["provenance_status"],
    claims: unknown = null
  ) => ({
    conversation: CONVERSATIONS[0]!,
    messages: [
      { id: "m-1", role: "user" as const, content: "posture report?", claims: null, created_at: "2026-08-14T10:00:00Z" },
      {
        id: "m-2",
        role: "assistant" as const,
        content: "Here is the report.",
        claims,
        provenance_status,
        created_at: "2026-08-14T10:00:05Z",
      },
    ],
  });

  it("says sources are processing — without implying anything is wrong", async () => {
    mockList.mockResolvedValue({ conversations: CONVERSATIONS });
    mockGet.mockResolvedValue(turn("pending"));
    render(<AskClient />);

    fireEvent.click(await screen.findByText("What are my critical findings?"));

    expect(await screen.findByText("Sources processing…")).toBeInTheDocument();
    // The answer is usable NOW — that has to be said, or "processing" reads as
    // "incomplete answer".
    expect(screen.getByText(/This answer is complete/)).toBeInTheDocument();
    expect(screen.getByText("Here is the report.")).toBeInTheDocument();
  });

  it("marks a failed decomposition as uncited rather than staying silent", async () => {
    mockList.mockResolvedValue({ conversations: CONVERSATIONS });
    mockGet.mockResolvedValue(turn("failed"));
    render(<AskClient />);

    fireEvent.click(await screen.findByText("What are my critical findings?"));

    expect(await screen.findByText("Sources unavailable")).toBeInTheDocument();
    expect(screen.getByText(/Treat it as uncited/)).toBeInTheDocument();
  });

  it("distinguishes a partially-verified answer from a clean one", async () => {
    mockList.mockResolvedValue({ conversations: CONVERSATIONS });
    mockGet.mockResolvedValue(turn("partial", CLAIMS_FIXTURE));
    render(<AskClient />);

    fireEvent.click(await screen.findByText("What are my critical findings?"));

    expect(await screen.findByText("Sources partially verified")).toBeInTheDocument();
    // Cited AND flagged — the claims still render.
    expect(screen.getByText("Provenance · 2 claims")).toBeInTheDocument();
  });

  it("adds no banner to a clean answer — the citations are the display", async () => {
    mockList.mockResolvedValue({ conversations: CONVERSATIONS });
    mockGet.mockResolvedValue(turn("complete", CLAIMS_FIXTURE));
    render(<AskClient />);

    fireEvent.click(await screen.findByText("What are my critical findings?"));

    expect(await screen.findByText("Provenance · 2 claims")).toBeInTheDocument();
    expect(screen.queryByText("Sources processing…")).not.toBeInTheDocument();
    expect(screen.queryByText("Sources unavailable")).not.toBeInTheDocument();
    expect(screen.queryByText("Sources partially verified")).not.toBeInTheDocument();
  });

  it("shows nothing when provenance never applied — absence is not a state", async () => {
    // A turn with no retrieval was never decomposable. Rendering a lifecycle
    // banner would invent a status the engine did not report.
    mockList.mockResolvedValue({ conversations: CONVERSATIONS });
    mockGet.mockResolvedValue(turn(null));
    render(<AskClient />);

    fireEvent.click(await screen.findByText("What are my critical findings?"));

    await screen.findByText("Here is the report.");
    expect(screen.queryByText(/^Sources /)).not.toBeInTheDocument();
  });
});
