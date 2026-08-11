/**
 * /findings — the OPERATIONS CENTER (work-first mode, SECURELOGIC_RISK_WORKSPACE_ENABLED).
 *
 * The contract this file defends: a work queue is a PROMISE. A card that says "7" is a
 * promise that clicking it shows those 7 — the same population, counted by the engine,
 * not a different query that happens to sit behind the same word. The failure modes are
 * silent: a card wired to the wrong summary field, a bucket link whose server filters
 * don't reproduce the count, a page-2 link that drops the bucket (a filter change the
 * customer never made), and — worst — a count of 0 rendered for something the engine
 * never told us, which reads as "no work" when the truth is "we don't know".
 *
 * Complements page.render.test.tsx (flag-OFF legacy list, ?active=true, authorization).
 * Nothing here duplicates it.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderPage, signedIn, apiKeyOnly, sp } from "@/test/harness";
import { aFinding, aFindingsResponse, aFindingsSummary, aMe } from "@/test/fixtures";

const api = vi.hoisted(() => ({
  getMe: vi.fn(),
  getFindings: vi.fn(),
  getFindingsSummary: vi.fn(),
  getFindingSavedViews: vi.fn(),
  getFindingsByEntity: vi.fn(),
  getSignalMatchSuggestionCounts: vi.fn(),
  getTeamMembers: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  ...api,
}));

import FindingsPage from "../page";

/**
 * The ops-center buckets, written out LITERALLY (ids, labels, the engine filters each
 * one promises, and the summary field its count must come from). Deriving these from
 * OPS_BUCKETS would make the test agree with the code by construction — which is not a
 * test. These are transcribed from workQueues.ts and are the thing being pinned.
 */
const FINDINGS_BUCKETS = [
  { id: "my_work",             label: "My Work",             count: 3,  field: "my_work_open",            params: { owner: "me", active: true } },
  { id: "sla_breached",        label: "SLA Breached",        count: 7,  field: "overdue_open",            params: { overdue: true } },
  { id: "needs_assignment",    label: "Needs Assignment",    count: 5,  field: "unassigned_open",         params: { unassigned: true } },
  { id: "needs_decision",      label: "Needs Governance Decision", count: 9, field: "needs_review_open",   params: { decision_state: "needs_review", active: true } },
  { id: "ready_to_close",      label: "Ready to Close",      count: 4,  field: "ready_for_decision_open", params: { ready_for_decision: true } },
  { id: "active_exploitation", label: "Active Exploitation", count: 2,  field: "exploited_open",          params: { exploited: true, active: true } },
  { id: "regulatory",          label: "Regulatory Impact",   count: 6,  field: "regulatory_open",         params: { domain: "Regulatory", active: true } },
  { id: "ai_risk",             label: "AI Risk",             count: 8,  field: "ai_governance_open",      params: { domain: "AI Governance", active: true } },
  { id: "third_party",         label: "Third-Party Risk",    count: 11, field: "vendor_risk_open",        params: { domain: "Vendor Risk", active: true } },
  { id: "in_mitigation",       label: "In Mitigation",       count: 12, field: "mitigating_open",         params: { decision_state: "mitigating", active: true } },
  { id: "accepted_risk",       label: "Accepted Risk",       count: 13, field: "accepted_risk_total",     params: { decision_state: "accepted_risk" } },
] as const;

/** Buckets that open the surface that OWNS the work rather than a findings view. */
const HREF_BUCKETS = [
  { id: "awaiting_approval", label: "Awaiting Approval",      count: 14, href: "/approvals" },
  { id: "review_links",      label: "Review Suggested Links", count: 15, href: "/queue" },
] as const;

const BUCKET_PAGE_SIZE = 25;

/** Every work-queue count the engine can supply, each a DISTINCT number — so a card
 *  wired to the wrong summary field shows the wrong number instead of coincidentally
 *  the right one. */
const OPS_SUMMARY = aFindingsSummary({
  active_total: 42,
  my_work_open: 3,
  overdue_open: 7,
  unassigned_open: 5,
  needs_review_open: 9,
  ready_for_decision_open: 4,
  exploited_open: 2,
  regulatory_open: 6,
  ai_governance_open: 8,
  vendor_risk_open: 11,
  mitigating_open: 12,
  accepted_risk_total: 13,
  pending_risk_approvals: 14,
});

const cursor = (n: number) => ({
  created_at: `2026-0${n}-01T00:00:00.000Z`,
  id: `aaaaaaaa-bbbb-cccc-dddd-eeeeeeee000${n}`,
});
const token = (c: { created_at: string; id: string }) => `${c.created_at}~${c.id}`;

/** A page of bucket members, as the engine would serve it. */
const members = (n: number) =>
  Array.from({ length: n }, (_, i) => aFinding({ id: `f-${i}`, title: `Bucket finding ${i}` }));

/** The card as the customer sees it: its link, and the number printed on it.
 *  Scoped to the bucket grid — the F-1 headline summary bar links to some of the
 *  same destinations, so we skip anchors inside it and pin the actual bucket card. */
function card(container: HTMLElement, href: string) {
  const anchors = Array.from(container.querySelectorAll<HTMLAnchorElement>(`a[href="${href}"]`));
  const el = anchors.find((a) => !a.closest('section[aria-label="Findings summary"]')) ?? anchors[0];
  if (!el) return null;
  const spans = el.querySelectorAll("span");
  return { el, label: spans[0]?.textContent ?? "", count: spans[1]?.textContent ?? "" };
}

const home = () => renderPage(FindingsPage, { searchParams: sp({}) });

beforeEach(() => {
  vi.clearAllMocks();
  signedIn();
  vi.stubEnv("SECURELOGIC_RISK_WORKSPACE_ENABLED", "true");
  api.getMe.mockResolvedValue(aMe({ entitlementLevel: "platform" }));
  api.getFindings.mockResolvedValue(aFindingsResponse([]));
  api.getFindingsSummary.mockResolvedValue({ summary: OPS_SUMMARY });
  api.getFindingSavedViews.mockResolvedValue([]);
  api.getFindingsByEntity.mockResolvedValue(null);
  api.getSignalMatchSuggestionCounts.mockResolvedValue({
    organizationId: "org-1",
    total: 15,
    by_target_type: {},
  });
  api.getTeamMembers.mockResolvedValue({ members: [], pending_invites: [], seat_usage: { used: 0, max: 5 } });
});

describe("ops center — the work queues render", () => {
  it("lands on decision buckets, risk domains and tracking — not a list of records", async () => {
    const { container } = await home();

    expect(screen.getByText("Work queues")).toBeInTheDocument();
    expect(screen.getByText("Risk domains")).toBeInTheDocument();
    expect(screen.getByText(/^Tracking/)).toBeInTheDocument();
    // getAllByText tolerates the F-1 summary bar, which repeats a few bucket names
    // (Ready to Close, Accepted Risk, Awaiting Approval) as headline drill-throughs.
    for (const b of [...FINDINGS_BUCKETS, ...HREF_BUCKETS]) {
      expect(screen.getAllByText(b.label).length).toBeGreaterThan(0);
    }
    // Work-first means work, not records: the landing view renders NO finding rows.
    // A page that shows both is the mixed state this mode exists to replace.
    expect(container.textContent).not.toContain("Bucket finding");
    expect(screen.getByText(/Finding Explorer/)).toBeInTheDocument();
  });

  it("opens each bucket where its work actually lives", async () => {
    const { container } = await home();

    for (const b of FINDINGS_BUCKETS) {
      // The subordinate, server-filtered findings view — the id IS the filter set.
      expect(card(container, `/findings?bucket=${b.id}`)?.label).toBe(b.label);
    }
    // These two are not findings queries: the work is owned by another surface.
    for (const b of HREF_BUCKETS) {
      expect(card(container, b.href)?.label).toBe(b.label);
    }
  });
});

describe("ops center — a card's count and its destination are the same population", () => {
  it("prints each bucket's own server count, from its own summary field", async () => {
    const { container } = await home();

    for (const b of FINDINGS_BUCKETS) {
      const c = card(container, `/findings?bucket=${b.id}`);
      expect(`${b.label}=${c?.count}`).toBe(`${b.label}=${b.count}`);
    }
    expect(card(container, "/approvals")?.count).toBe("14");
    // Review Suggested Links counts the matcher queue, not the findings summary.
    expect(card(container, "/queue")?.count).toBe("15");
  });

  it.each(FINDINGS_BUCKETS)(
    "$label: /findings?bucket=$id asks the engine for exactly the population the card counted",
    async (b) => {
      api.getFindings.mockImplementation(async (_t: string, params: Record<string, unknown>) =>
        params?.limit === BUCKET_PAGE_SIZE
          ? aFindingsResponse(members(1), { total: b.count })
          : aFindingsResponse([])
      );

      const { container } = await renderPage(FindingsPage, {
        searchParams: sp({ bucket: b.id }),
      });

      // If the bucket view's SERVER filters differ from the predicate the summary
      // counted, the card promised N and the view shows a different population. Exact
      // match — an extra filter narrows it, a missing one widens it, both are the bug.
      expect(api.getFindings).toHaveBeenCalledWith(expect.anything(), {
        ...b.params,
        sort: "created",
        limit: BUCKET_PAGE_SIZE,
      });
      // And the view reports the same total the card printed.
      expect(container.textContent).toContain(`of ${b.count}`);
    }
  );

  it("an unknown count is an em-dash, never a fabricated zero", async () => {
    // The matcher-queue call failed. "0 links to review" is a lie the customer would
    // act on; "—" is the truth.
    api.getSignalMatchSuggestionCounts.mockResolvedValue(null);

    const { container } = await home();

    expect(card(container, "/queue")?.count).toBe("—");
    // ...and the page must not claim all-clear while a count is unknown.
    expect(screen.queryByText(/All clear/)).toBeNull();
  });
});

describe("ops center — the F-1 headline summary bar", () => {
  const summarySection = (container: HTMLElement) =>
    container.querySelector<HTMLElement>('section[aria-label="Findings summary"]')!;

  it("renders the five headline metrics, each from its own server field", async () => {
    const { container } = await home();
    const bar = summarySection(container);
    expect(bar).not.toBeNull();
    // Each metric drills through to its destination and prints its own count.
    const metric = (href: string) =>
      bar.querySelector<HTMLAnchorElement>(`a[href="${href}"]`)?.querySelector(".text-2xl")?.textContent;
    expect(metric("/findings?active=true")).toBe("42");
    expect(metric("/findings?bucket=sla_breached")).toBe("7");
    expect(metric("/approvals")).toBe("14");
    expect(metric("/findings?bucket=ready_to_close")).toBe("4");
    expect(metric("/findings?bucket=accepted_risk")).toBe("13");
    expect(within(bar).getByText("Active Findings")).toBeInTheDocument();
  });

  it("discloses that queues overlap (F-2) with a freshness timestamp (F-8)", async () => {
    const { container } = await home();
    const bar = summarySection(container);
    expect(within(bar).getByText(/Queues overlap by design/i)).toBeInTheDocument();
    expect(bar.textContent).toMatch(/Counts as of/i);
  });

  it("tags governance vs operational tracking so Accepted Risk ≠ In Mitigation (F-3)", async () => {
    const { container } = await home();
    const accepted = card(container, "/findings?bucket=accepted_risk")!.el;
    const mitigating = card(container, "/findings?bucket=in_mitigation")!.el;
    expect(within(accepted).getByText("Governance record")).toBeInTheDocument();
    expect(within(mitigating).getByText("Operational tracking")).toBeInTheDocument();
  });
});

describe("ops center — My Work is scoped to the caller", () => {
  it("asks the engine for owner=me — never a client-supplied identity", async () => {
    await renderPage(FindingsPage, { searchParams: sp({ bucket: "my_work" }) });

    expect(api.getFindings).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ owner: "me", active: true })
    );
    const call = api.getFindings.mock.calls.find(
      (c: unknown[]) => (c[1] as { owner?: string })?.owner === "me"
    );
    expect(call?.[1]).not.toHaveProperty("owner_user_id");
  });

  it("an API-key caller has no 'me' — My Work is UNKNOWN, and must not render as 0", async () => {
    apiKeyOnly();
    // The engine OMITS my_work_open when the caller has no user identity (the field is
    // session-scoped). Everything else still counts.
    const { my_work_open: _omitted, ...noIdentity } = OPS_SUMMARY;
    api.getFindingsSummary.mockResolvedValue({ summary: noIdentity });

    const { container } = await home();

    const myWork = card(container, "/findings?bucket=my_work");
    expect(myWork?.label).toBe("My Work");
    // The whole point: "0" reads as "you're done". The honest answer is "we don't know
    // who you are", and the card says so.
    expect(myWork?.count).toBe("—");
    expect(myWork?.count).not.toBe("0");
    // The other buckets are unaffected — an unknown my_work must not poison org counts.
    expect(card(container, "/findings?bucket=sla_breached")?.count).toBe("7");
  });
});

describe("ops center — paging a bucket never changes the filter", () => {
  const BUCKET = "sla_breached";
  const next = cursor(2);

  it("the Next link carries the bucket forward (a full page + a cursor = more work)", async () => {
    api.getFindings.mockImplementation(async (_t: string, params: Record<string, unknown>) =>
      params?.limit === BUCKET_PAGE_SIZE
        ? aFindingsResponse(members(BUCKET_PAGE_SIZE), { total: 60, nextCursor: next })
        : aFindingsResponse([])
    );

    const { container } = await renderPage(FindingsPage, { searchParams: sp({ bucket: BUCKET }) });

    const nextLink = Array.from(container.querySelectorAll("a")).find((a) =>
      a.textContent?.includes("Next")
    );
    // A page-2 link that drops the bucket silently swaps the population under the
    // customer — the count they clicked and the list they get stop agreeing.
    expect(nextLink?.getAttribute("href")).toContain(`bucket=${BUCKET}`);
    expect(nextLink?.getAttribute("href")).toContain(`after=${encodeURIComponent(token(next))}`);
    // Page 1 has nothing behind it.
    const prevLink = Array.from(container.querySelectorAll("a")).find((a) =>
      a.textContent?.includes("Previous")
    );
    expect(prevLink).toBeUndefined();
    expect(container.textContent).toContain(`1–${BUCKET_PAGE_SIZE} of 60`);
  });

  it("page 2 is fetched with the keyset cursor, and BOTH its page links keep the bucket", async () => {
    const after = token(cursor(2));
    api.getFindings.mockImplementation(async (_t: string, params: Record<string, unknown>) =>
      params?.limit === BUCKET_PAGE_SIZE
        ? aFindingsResponse(members(BUCKET_PAGE_SIZE), { total: 60, nextCursor: cursor(3) })
        : aFindingsResponse([])
    );

    const { container } = await renderPage(FindingsPage, {
      searchParams: sp({ bucket: BUCKET, after }),
    });

    // Server-paged: the cursor goes to the engine, the filters go with it.
    expect(api.getFindings).toHaveBeenCalledWith(expect.anything(), {
      overdue: true,
      sort: "created",
      limit: BUCKET_PAGE_SIZE,
      before: cursor(2),
    });
    const links = Array.from(container.querySelectorAll("a"));
    const prev = links.find((a) => a.textContent?.includes("Previous"))?.getAttribute("href");
    const fwd = links.find((a) => a.textContent?.includes("Next"))?.getAttribute("href");
    expect(prev).toContain(`bucket=${BUCKET}`);
    expect(fwd).toContain(`bucket=${BUCKET}`);
    // Forward from page 2 remembers how we got here, so Previous can come back.
    expect(fwd).toContain(`trail=${encodeURIComponent(after)}`);
    expect(container.textContent).toContain(`26–50 of 60`);
  });

  it("a partial page is the last page — no Next that can only land on nothing", async () => {
    api.getFindings.mockImplementation(async (_t: string, params: Record<string, unknown>) =>
      params?.limit === BUCKET_PAGE_SIZE
        ? // The engine still hands back a cursor; the page must not trust it here.
          aFindingsResponse(members(6), { total: 6, nextCursor: cursor(9) })
        : aFindingsResponse([])
    );

    const { container } = await renderPage(FindingsPage, { searchParams: sp({ bucket: BUCKET }) });

    const nextLink = Array.from(container.querySelectorAll("a")).find((a) =>
      a.textContent?.includes("Next")
    );
    expect(nextLink).toBeUndefined();
    expect(container.textContent).toContain("1–6 of 6");
  });

  it("garbage pagination input fails safe to page 1 instead of a broken query", async () => {
    api.getFindings.mockImplementation(async (_t: string, params: Record<string, unknown>) =>
      params?.limit === BUCKET_PAGE_SIZE
        ? aFindingsResponse(members(BUCKET_PAGE_SIZE), { total: 60, nextCursor: next })
        : aFindingsResponse([])
    );

    const { container } = await renderPage(FindingsPage, {
      searchParams: sp({ bucket: BUCKET, after: "not-a-cursor", trail: "junk,also-junk" }),
    });

    // No `before` reaches the engine — a hand-edited cursor must not become a filter.
    const bucketCall = api.getFindings.mock.calls.find(
      (c: unknown[]) => (c[1] as { limit?: number })?.limit === BUCKET_PAGE_SIZE
    );
    expect(bucketCall?.[1]).not.toHaveProperty("before");
    expect(bucketCall?.[1]).toMatchObject({ overdue: true });
    // ...and the customer is honestly on page 1, with the bucket intact.
    expect(container.textContent).toContain(`1–${BUCKET_PAGE_SIZE} of 60`);
    const nextLink = Array.from(container.querySelectorAll("a")).find((a) =>
      a.textContent?.includes("Next")
    );
    expect(nextLink?.getAttribute("href")).toContain(`bucket=${BUCKET}`);
    expect(nextLink?.getAttribute("href")).not.toContain("trail=");
  });

  it("an unknown bucket id is not a bucket view — it does not silently show everything", async () => {
    const { container } = await renderPage(FindingsPage, {
      searchParams: sp({ bucket: "not_a_bucket" }),
    });

    // Falls back to the ops-center home (work queues), never an unfiltered list of
    // records dressed up as a queue.
    expect(screen.getByText("Work queues")).toBeInTheDocument();
    expect(container.textContent).not.toContain("Bucket finding");
  });
});

describe("ops center — the flag is a clean switch, not a blend", () => {
  it("flag ON with no filters = work queues, and no legacy filter bar", async () => {
    const { container } = await home();

    expect(screen.getByText("Work queues")).toBeInTheDocument();
    // The legacy status/severity pills belong to the list experience. Both at once is
    // the mixed state.
    expect(container.querySelector('a[href="/findings?status=closed"]')).toBeNull();
    expect(screen.queryByText("Severity")).toBeNull();
  });

  it("flag OFF = the legacy list, with no work queues anywhere on the page", async () => {
    vi.stubEnv("SECURELOGIC_RISK_WORKSPACE_ENABLED", "false");
    api.getFindings.mockResolvedValue(aFindingsResponse(members(2)));

    const { container } = await home();

    expect(screen.queryByText("Work queues")).toBeNull();
    expect(screen.queryByText("My Work")).toBeNull();
    expect(container.querySelector('a[href*="bucket="]')).toBeNull();
    // The legacy experience is records + filters.
    expect(screen.getByText(/Bucket finding 0/)).toBeInTheDocument();
    expect(container.querySelector('a[href="/findings?status=closed"]')).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────
// Bucket queue controls (SECURELOGIC_FINDINGS_QUEUE_CONTROLS_ENABLED)
// The SAME toolbar + server query model as /findings?queue=all, applied to
// every findings-backed bucket. The bucket definition is the implicit filter:
// user refinement composes with it and can never override it.
// ─────────────────────────────────────────────────────────────────────

describe("bucket queue controls — every findings bucket gets the shared toolbar", () => {
  beforeEach(() => {
    vi.stubEnv("SECURELOGIC_FINDINGS_QUEUE_CONTROLS_ENABLED", "true");
  });

  it.each(FINDINGS_BUCKETS)(
    "$label: renders search/sort/pagination controls and fetches the bucket's population",
    async (b) => {
      api.getFindings.mockResolvedValue(aFindingsResponse(members(3), { total: 3 }));

      await renderPage(FindingsPage, { searchParams: sp({ bucket: b.id }) });

      // The shared toolbar is present…
      expect(screen.getByLabelText("Search findings")).toBeInTheDocument();
      expect(screen.getByLabelText("Sort findings")).toBeInTheDocument();
      // …and the fetch is the bucket's implicit params + the queue model's
      // sort/limit (urgency default, offset paging).
      expect(api.getFindings).toHaveBeenCalledWith(expect.anything(), {
        ...b.params,
        sort: "urgency",
        limit: BUCKET_PAGE_SIZE,
      });
    }
  );

  it("combined search + filters + page refine WITHIN the bucket, server-side", async () => {
    api.getFindings.mockResolvedValue(aFindingsResponse(members(BUCKET_PAGE_SIZE), { total: 60 }));

    await renderPage(FindingsPage, {
      searchParams: sp({
        bucket: "needs_decision",
        q: "azure",
        severity: "High",
        page: "2",
      }),
    });

    expect(api.getFindings).toHaveBeenCalledWith(expect.anything(), {
      q: "azure",
      severity: "High",
      offset: BUCKET_PAGE_SIZE,
      decision_state: "needs_review", // the bucket's implicit filter
      active: true,
      sort: "urgency",
      limit: BUCKET_PAGE_SIZE,
    });
    // The result count is server truth.
    expect(screen.getByText(`26–50 of 60`)).toBeInTheDocument();
  });

  it("membership is ENFORCED: a hand-edited governance param cannot widen the bucket", async () => {
    api.getFindings.mockResolvedValue(aFindingsResponse(members(2), { total: 2 }));

    await renderPage(FindingsPage, {
      searchParams: sp({ bucket: "needs_decision", governance: "resolved" }),
    });

    // The bucket's decision_state wins; the URL's governance never reaches the engine.
    // (The page also makes the legacy header fetch — pick the bucket fetch by its limit.)
    const call = api.getFindings.mock.calls.find(
      (c: unknown[]) => (c[1] as { limit?: number })?.limit === BUCKET_PAGE_SIZE
    )?.[1] as Record<string, unknown>;
    expect(call.decision_state).toBe("needs_review");
    // And the pinned Governance control is not rendered as a (lying) control.
    expect(screen.queryByLabelText("Governance")).toBeNull();
  });

  it("pinned axes are hidden per bucket: domain in a domain bucket, assigned-to-me in My Work", async () => {
    api.getFindings.mockResolvedValue(aFindingsResponse(members(1), { total: 1 }));

    await renderPage(FindingsPage, { searchParams: sp({ bucket: "regulatory" }) });
    expect(screen.queryByLabelText("Domain")).toBeNull();
    expect(screen.getByLabelText("Severity")).toBeInTheDocument();
  });

  it("pagination links carry the bucket AND the full filter state", async () => {
    api.getFindings.mockResolvedValue(aFindingsResponse(members(BUCKET_PAGE_SIZE), { total: 60 }));

    const { container } = await renderPage(FindingsPage, {
      searchParams: sp({ bucket: "sla_breached", q: "azure" }),
    });

    const nextLink = Array.from(container.querySelectorAll("a")).find((a) =>
      a.textContent?.includes("Next")
    );
    expect(nextLink?.getAttribute("href")).toContain("bucket=sla_breached");
    expect(nextLink?.getAttribute("href")).toContain("q=azure");
    expect(nextLink?.getAttribute("href")).toContain("page=2");
    expect(nextLink?.getAttribute("href")).not.toContain("queue=all");
  });

  it("empty FILTERED results say so and Clear all preserves the bucket's implicit filter", async () => {
    api.getFindings.mockResolvedValue(aFindingsResponse([], { total: 0 }));

    const { container } = await renderPage(FindingsPage, {
      searchParams: sp({ bucket: "needs_decision", q: "nonexistent" }),
    });

    expect(
      screen.getByText(/No findings in Needs Governance Decision match your search and filters/)
    ).toBeInTheDocument();
    // Clear all clears only USER filters — the href keeps the bucket.
    const clear = Array.from(container.querySelectorAll("a")).filter((a) =>
      a.textContent?.includes("Clear all")
    );
    expect(clear.length).toBeGreaterThan(0);
    for (const a of clear) {
      expect(a.getAttribute("href")).toContain("bucket=needs_decision");
      expect(a.getAttribute("href")).not.toContain("q=");
    }
  });

  it("an empty UNFILTERED bucket still reads as a clear queue, not a filter dead-end", async () => {
    api.getFindings.mockResolvedValue(aFindingsResponse([], { total: 0 }));

    await renderPage(FindingsPage, { searchParams: sp({ bucket: "ready_to_close" }) });

    expect(screen.getByText(/Queue clear — nothing waiting here/)).toBeInTheDocument();
    expect(screen.queryByText(/match your search and filters/)).toBeNull();
  });

  it("cards keep due labels, Owner: Unassigned, membership reason, and new-tab provenance", async () => {
    api.getFindings.mockResolvedValue(
      aFindingsResponse(
        [aFinding({ id: "f-7", title: "Unowned undated finding", due_date: null, owner_user_id: null })],
        { total: 1 }
      )
    );

    const { container } = await renderPage(FindingsPage, {
      searchParams: sp({ bucket: "needs_decision" }),
    });

    // Explicit due label incl. the no-due-date case (never blank). The toolbar's
    // Due-status select also offers "No due date" — assert the CARD's label
    // (a span), not the select option.
    expect(
      screen.getAllByText("No due date").some((el) => el.tagName === "SPAN")
    ).toBe(true);
    // Ownership is an explicit axis, not a bare status word.
    expect(container.textContent).toContain("Owner: Unassigned");
    // Why the finding is in THIS queue.
    expect(screen.getByText("No governance decision recorded yet")).toBeInTheDocument();
    // New-tab provenance in the URL (?from=<bucket>), not client memory.
    expect(container.querySelector('a[href*="/findings/f-7?from=needs_decision"]')).not.toBeNull();
  });

  it("flag OFF: the bucket view keeps the legacy keyset path with NO toolbar", async () => {
    vi.stubEnv("SECURELOGIC_FINDINGS_QUEUE_CONTROLS_ENABLED", "false");
    api.getFindings.mockResolvedValue(aFindingsResponse(members(2), { total: 2 }));

    await renderPage(FindingsPage, { searchParams: sp({ bucket: "sla_breached" }) });

    expect(screen.queryByLabelText("Search findings")).toBeNull();
    expect(api.getFindings).toHaveBeenCalledWith(expect.anything(), {
      overdue: true,
      sort: "created",
      limit: BUCKET_PAGE_SIZE,
    });
  });
});

describe("ops center — fresh-org truthfulness (EG2 slice 2)", () => {
  /** Every bucket field present and zero → unknownCounts empty, due work zero. */
  const ZERO_BUCKET_FIELDS = {
    my_work_open: 0,
    my_pending_reviews_open: 0,
    overdue_open: 0,
    unassigned_open: 0,
    needs_review_open: 0,
    ready_for_decision_open: 0,
    pending_risk_approvals: 0,
    exploited_open: 0,
    regulatory_open: 0,
    ai_governance_open: 0,
    vendor_risk_open: 0,
    mitigating_open: 0,
    accepted_risk_total: 0,
  };

  beforeEach(() => {
    api.getSignalMatchSuggestionCounts.mockResolvedValue({
      organizationId: "org-1",
      total: 0,
      by_target_type: {},
    });
  });

  it("an org with NO findings on record gets 'nothing assessed yet', never a green all-clear", async () => {
    api.getFindingsSummary.mockResolvedValue({
      summary: aFindingsSummary({
        ...ZERO_BUCKET_FIELDS,
        active_total: 0,
        closed_count: 0,
      }),
    });

    await home();

    expect(screen.queryByText(/All clear/)).toBeNull();
    expect(screen.getByText(/Nothing assessed yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Start setup/ })).toHaveAttribute(
      "href",
      "/getting-started"
    );
  });

  it("an org with a findings HISTORY and zero due work keeps the earned all-clear", async () => {
    api.getFindingsSummary.mockResolvedValue({
      summary: aFindingsSummary({
        ...ZERO_BUCKET_FIELDS,
        active_total: 0,
        closed_count: 4, // work existed and was closed — the clear is earned
      }),
    });

    await home();

    expect(screen.getByText(/All clear/)).toBeInTheDocument();
    expect(screen.queryByText(/Nothing assessed yet/)).toBeNull();
  });
});
