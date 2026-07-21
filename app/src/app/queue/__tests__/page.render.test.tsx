/**
 * /queue — "Review Suggested Links" render contract.
 *
 * WHAT THIS FILE PROTECTS: the queue is the one screen where our matcher's internal
 * vocabulary is closest to the customer's eyes. The row payload literally carries
 * `match_reason: "vendor_name_ilike"`, `target_type: "ai_system"` and a raw signal
 * UUID. R3 turned the queue into a work surface and the workspace reskin translated
 * that vocabulary into business language — but the translation lives in the RENDER,
 * so only a render test can hold it. The engine tests assert the query; they cannot
 * see what the customer reads.
 *
 * NOTE ON THE FLAG: the customer-facing language contract belongs to the
 * SECURELOGIC_RISK_WORKSPACE_ENABLED=true branch. The flag-off branch is the legacy
 * "Matcher queue" and is byte-for-byte preserved on purpose (GATE B). Both branches
 * are pinned below — including, honestly, the fact that the legacy one still shows a
 * raw match code.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import {
  renderPage,
  expectRedirect,
  signedIn,
  signedOut,
  apiKeyOnly,
  sp,
} from "@/test/harness";
import { aMe, aSuggestion, aSuggestionCounts, aSuggestionsResponse } from "@/test/fixtures";

const api = vi.hoisted(() => ({
  getMe: vi.fn(),
  getSignalMatchSuggestions: vi.fn(),
  getSignalMatchSuggestionCounts: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}));

import QueuePage from "../page";

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** One vendor row and one AI-system row — both carrying raw matcher vocabulary. */
const ROWS = [
  aSuggestion({
    id: "sug-1",
    target_type: "vendor",
    target_name: "Acme Cloud",
    match_reason: "vendor_name_ilike",
    match_score: 82,
  }),
  aSuggestion({
    id: "sug-2",
    target_type: "ai_system",
    target_id: "22222222-3333-4444-8555-666666666666",
    target_name: "Claims Triage Copilot",
    match_reason: "ai_system_fuzzy_name",
    match_score: 45,
    event_title: "Model-serving framework advisory",
    event_canonical_key: "CVE-2026-9999",
  }),
];

const COUNTS = aSuggestionCounts({
  total: 2,
  by_target_type: { vendor: 1, ai_system: 1, control: 0, obligation: 0 },
  lifetime_total: 2,
});

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
  // The page's real gate is getMe().entitlementLevel ∈ {premium, platform, team}.
  api.getMe.mockResolvedValue(aMe({ entitlementLevel: "premium" }));
  api.getSignalMatchSuggestions.mockResolvedValue(aSuggestionsResponse(ROWS));
  api.getSignalMatchSuggestionCounts.mockResolvedValue(COUNTS);
});

describe("/queue — the customer's language, not the matcher's", () => {
  it("shows human entity labels, never the raw target_type enum", async () => {
    vi.stubEnv("SECURELOGIC_RISK_WORKSPACE_ENABLED", "true");

    const { container } = await renderPage(QueuePage, { searchParams: sp({}) });
    const text = container.textContent ?? "";

    // The label maps the page actually owns: TARGET_LABEL (page) and its row twin.
    expect(text).toContain("AI Systems"); // filter chip
    expect(text).toContain("AI System"); // row badge
    expect(text).toContain("Vendor");

    // The wire value must never surface. `ai_system` is what the engine sends and
    // what a customer must never be asked to decode.
    expect(text).not.toMatch(/\bai_system\b/);
    expect(text).not.toMatch(/\bvendor_review\b/);
    expect(text).not.toMatch(/\bai_governance_review\b/);
  });

  it("explains WHY a link was suggested in English — never a raw match_reason code", async () => {
    vi.stubEnv("SECURELOGIC_RISK_WORKSPACE_ENABLED", "true");

    const { container } = await renderPage(QueuePage, { searchParams: sp({}) });
    const text = container.textContent ?? "";

    // describeMatchReason() is the contract; "vendor_name_ilike" is the code it hides.
    expect(text).toContain("SecureLogic found this vendor's name in the intelligence signal.");
    expect(text).toContain("The signal closely matches this AI system's name.");
    expect(text).not.toContain("vendor_name_ilike");
    expect(text).not.toContain("ai_system_fuzzy_name");
    expect(text).not.toContain("match_reason");
  });

  it("renders no bare UUID and no raw score — the customer reads titles and confidence", async () => {
    vi.stubEnv("SECURELOGIC_RISK_WORKSPACE_ENABLED", "true");

    const { container } = await renderPage(QueuePage, { searchParams: sp({}) });
    const text = container.textContent ?? "";

    // A truncated signal UUID ("Signal 3f2a1b2c…") is the legacy fallback. In the
    // customer-facing branch the row must lead with the intelligence event's title.
    expect(text).not.toMatch(UUID_RE);
    expect(text).not.toContain("Signal 3f2a");
    expect(text).toContain("Actively exploited RCE in Acme Cloud Gateway");
    expect(text).toContain("Model-serving framework advisory");

    // The 0–100 match score is internal; the band is what ships.
    expect(text).toContain("High confidence");
    expect(text).toContain("Medium confidence");
  });
});

describe("/queue — accept / dismiss render where the caller is authorized", () => {
  it("an authorized caller gets both controls on every row", async () => {
    vi.stubEnv("SECURELOGIC_RISK_WORKSPACE_ENABLED", "true");

    await renderPage(QueuePage, { searchParams: sp({}) });

    // Two rows → two Accept and two Dismiss buttons. A review queue whose decision
    // controls do not render is a dump you cannot action.
    expect(screen.getAllByRole("button", { name: "Accept" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Dismiss" })).toHaveLength(2);
  });

  it("an API-key caller with the entitlement is authorized too (token, not user identity)", async () => {
    vi.stubEnv("SECURELOGIC_RISK_WORKSPACE_ENABLED", "true");
    apiKeyOnly();

    await renderPage(QueuePage, { searchParams: sp({}) });

    expect(screen.getAllByRole("button", { name: "Accept" })).toHaveLength(2);
  });

  it("a caller WITHOUT the platform entitlement never reaches the controls", async () => {
    vi.stubEnv("SECURELOGIC_RISK_WORKSPACE_ENABLED", "true");
    // "professional" = Brief Pro. The suggestions API is requireEntitlement("premium"),
    // so the page must send this caller away rather than strand them on an empty queue
    // with Accept buttons that would 403.
    api.getMe.mockResolvedValue(aMe({ entitlementLevel: "professional" }));

    expect(await expectRedirect(QueuePage, { searchParams: sp({}) })).toBe("/dashboard");
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
  });

  it("a getMe() failure is treated as unentitled, not as platform access", async () => {
    vi.stubEnv("SECURELOGIC_RISK_WORKSPACE_ENABLED", "true");
    api.getMe.mockResolvedValue(null);

    expect(await expectRedirect(QueuePage, { searchParams: sp({}) })).toBe("/dashboard");
  });

  it("the bulk decision controls are offered in the workspace branch only", async () => {
    vi.stubEnv("SECURELOGIC_RISK_WORKSPACE_ENABLED", "true");
    const { unmount } = await renderPage(QueuePage, { searchParams: sp({}) });
    expect(screen.getByRole("button", { name: "Select" })).toBeInTheDocument();
    unmount();

    vi.stubEnv("SECURELOGIC_RISK_WORKSPACE_ENABLED", "false");
    await renderPage(QueuePage, { searchParams: sp({}) });
    expect(screen.queryByRole("button", { name: "Select" })).toBeNull();
  });
});

describe("/queue — empty states are honest, and are not dead ends", () => {
  it("first-time empty explains what the queue is FOR and offers no fake controls", async () => {
    vi.stubEnv("SECURELOGIC_RISK_WORKSPACE_ENABLED", "true");
    api.getSignalMatchSuggestions.mockResolvedValue(aSuggestionsResponse([]));
    api.getSignalMatchSuggestionCounts.mockResolvedValue(
      aSuggestionCounts({ total: 0, by_target_type: { vendor: 0, ai_system: 0, control: 0, obligation: 0 }, lifetime_total: 0 })
    );

    const { container } = await renderPage(QueuePage, { searchParams: sp({}) });

    expect(screen.getByText("Nothing to review yet")).toBeInTheDocument();
    expect(container.textContent).toContain("Suggested links appear here as new intelligence arrives.");
    // "No suggestions" must not be dressed up with decision buttons.
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    // ...and the never-seen-a-suggestion org is NOT told its filters are wrong.
    expect(container.textContent).not.toContain("match the current filters");
  });

  it("filtered-empty is a DIFFERENT state, and always offers the way out", async () => {
    vi.stubEnv("SECURELOGIC_RISK_WORKSPACE_ENABLED", "true");
    // lifetime_total > 0: this org HAS had suggestions — the filter is why the list
    // is empty. Telling them "nothing to review yet" here would be a lie.
    api.getSignalMatchSuggestions.mockResolvedValue(aSuggestionsResponse([]));
    api.getSignalMatchSuggestionCounts.mockResolvedValue(
      aSuggestionCounts({ total: 3, by_target_type: { vendor: 3, ai_system: 0, control: 0, obligation: 0 }, lifetime_total: 9 })
    );

    const { container } = await renderPage(QueuePage, { searchParams: sp({ target_type: "control" }) });

    expect(container.textContent).toContain("No suggested links match the current filters.");
    expect(container.textContent).not.toContain("Nothing to review yet");
    const clear = Array.from(container.querySelectorAll("a")).find(
      (a) => a.textContent?.trim() === "Clear filters"
    );
    expect(clear?.getAttribute("href")).toBe("/queue");
  });
});

describe("/queue — feature-flag branches (no mixed state)", () => {
  it("flag ON is the customer-facing 'Review Suggested Links' surface", async () => {
    vi.stubEnv("SECURELOGIC_RISK_WORKSPACE_ENABLED", "true");

    const { container } = await renderPage(QueuePage, { searchParams: sp({}) });
    const text = container.textContent ?? "";

    expect(screen.getByRole("heading", { name: "Review Suggested Links" })).toBeInTheDocument();
    expect(text).not.toContain("Matcher queue");
    // Sort vocabulary moves with the branch — "score" is an internal word.
    expect(text).toContain("Highest confidence first");
    expect(text).not.toContain("Highest score first");
  });

  it("flag OFF is the legacy 'Matcher queue', unchanged — and still speaks matcher", async () => {
    vi.stubEnv("SECURELOGIC_RISK_WORKSPACE_ENABLED", "false");

    const { container } = await renderPage(QueuePage, { searchParams: sp({}) });
    const text = container.textContent ?? "";

    expect(screen.getByRole("heading", { name: "Matcher queue" })).toBeInTheDocument();
    expect(text).not.toContain("Review Suggested Links");
    expect(text).toContain("Highest score first");

    // Pinning the legacy branch as it IS, not as we wish it were: the raw match code
    // and the truncated signal UUID are exactly what this branch shows. This is the
    // branch production runs today (render.yaml: "false"), and the reason the flag
    // flip matters. See the report accompanying this suite.
    expect(text).toContain("Match: vendor_name_ilike");
    expect(text).toContain("Signal 3f2a1b2c…");
    expect(text).not.toContain("High confidence");
  });

  it("the engine query is identical under both flag branches — the reskin is presentation only", async () => {
    vi.stubEnv("SECURELOGIC_RISK_WORKSPACE_ENABLED", "true");
    const { unmount } = await renderPage(QueuePage, { searchParams: sp({}) });
    const onParams = api.getSignalMatchSuggestions.mock.calls[0][1];
    unmount();

    vi.clearAllMocks();
    api.getMe.mockResolvedValue(aMe({ entitlementLevel: "premium" }));
    api.getSignalMatchSuggestions.mockResolvedValue(aSuggestionsResponse(ROWS));
    api.getSignalMatchSuggestionCounts.mockResolvedValue(COUNTS);

    vi.stubEnv("SECURELOGIC_RISK_WORKSPACE_ENABLED", "false");
    await renderPage(QueuePage, { searchParams: sp({}) });
    const offParams = api.getSignalMatchSuggestions.mock.calls[0][1];

    expect(onParams).toEqual(offParams);
    expect(onParams).toMatchObject({ status: "pending", sort: "created-desc", limit: 25, offset: 0 });
  });
});

describe("/queue — authorization", () => {
  it("sends a signed-out visitor to /login", async () => {
    signedOut();
    expect(await expectRedirect(QueuePage, { searchParams: sp({}) })).toBe("/login");
  });

  it("never asks the engine for suggestions on behalf of a signed-out visitor", async () => {
    signedOut();
    await expectRedirect(QueuePage, { searchParams: sp({}) });
    expect(api.getSignalMatchSuggestions).not.toHaveBeenCalled();
  });
});
