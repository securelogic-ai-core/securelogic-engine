/**
 * /intelligence/[id] — Intelligence Event drill-through (ERIP Package 3.3, PR-2).
 *
 * A DRILL-THROUGH ONLY surface: reached from a Finding (and, later, Review
 * Links), never from primary navigation — there is deliberately no /intelligence
 * index route and no nav entry (design §6).
 *
 * Two-switch dark launch:
 *   - SECURELOGIC_DECISION_WORKSPACE_ENABLED off  → notFound() (fail-closed 404),
 *     so the whole surface is invisible while dark.
 *   - on: render the canonical event from GET /api/intelligence/events/:id
 *     (its own SECURELOGIC_INTELLIGENCE_EVENTS_ENABLED flag). When that engine
 *     surface is dark but the user arrived from a Finding (?finding=<id>), fall
 *     back to the finding-context event summary. When neither is available, show
 *     the honest "intelligence detail unavailable" state — never a crash/blank.
 */

import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getIntelligenceEvent, getFindingContext } from "@/lib/api";
import { IntelligenceEventDetail, IntelligenceEventUnavailable } from "./IntelligenceEventDetail";
import {
  resolveIntelligenceDetail,
  extractFindingContextEvent,
  type FindingContextEventBundle,
} from "./intelligenceDetailView";

export default async function IntelligenceEventPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ finding?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  // Fail-closed: the drill-through is invisible while the Decision Workspace is dark.
  if (process.env.SECURELOGIC_DECISION_WORKSPACE_ENABLED !== "true") notFound();

  // The originating finding, if any — used both for the back link and as the
  // finding-context fallback when the canonical events surface is dark.
  const backHref = sp.finding ? `/findings/${sp.finding}` : "/findings";

  // Primary source: the canonical event (PR-1 fetcher; null when its flag is dark).
  const enrichment = await getIntelligenceEvent(token, id);

  // Fallback: the finding-context event summary (Decision Workspace flag).
  let fallback: FindingContextEventBundle | null = null;
  if (!enrichment && sp.finding) {
    const context = await getFindingContext(token, sp.finding);
    if (context) fallback = extractFindingContextEvent(context.intelligence, id);
  }

  const view = resolveIntelligenceDetail(enrichment, fallback);
  if (!view) return <IntelligenceEventUnavailable id={id} backHref={backHref} />;

  return <IntelligenceEventDetail view={view} backHref={backHref} />;
}
