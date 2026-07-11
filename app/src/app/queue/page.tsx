import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { buildQueueHref, isUuid } from "./queueHref";
import {
  getMe,
  getSignalMatchSuggestions,
  getSignalMatchSuggestionCounts,
  type SignalMatchTargetType,
} from "@/lib/api";
import {
  SuggestionList,
  type EnrichedSuggestion,
} from "@/components/queue/SuggestionList";

const PAGE_SIZE = 25;

const TARGET_TYPES: readonly SignalMatchTargetType[] = [
  "vendor",
  "ai_system",
  "control",
  "obligation",
];

const TARGET_LABEL: Record<SignalMatchTargetType, string> = {
  vendor:     "Vendors",
  ai_system:  "AI Systems",
  control:    "Controls",
  obligation: "Obligations",
};

const SORT_LABEL: Record<"created-desc" | "score-desc", string> = {
  "created-desc": "Newest first",
  "score-desc":   "Highest score first",
};

// Workspace reskin avoids the raw "score" term in favor of "confidence".
const WORKSPACE_SORT_LABEL: Record<"created-desc" | "score-desc", string> = {
  "created-desc": "Newest first",
  "score-desc":   "Highest confidence first",
};

function isTargetType(v: string | undefined): v is SignalMatchTargetType {
  return v !== undefined && (TARGET_TYPES as readonly string[]).includes(v);
}

function isSort(v: string | undefined): v is "created-desc" | "score-desc" {
  return v === "created-desc" || v === "score-desc";
}


export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  // Platform (rank-4) feature: the signal-match-suggestions API the queue reads
  // is gated at requireEntitlement("premium"). getMe() is the source of truth for
  // entitlement (never the session cookie, which may be stale after a Stripe
  // upgrade). Redirect rank-2 (Brief-Pro) users to /dashboard so the premium API
  // flip doesn't strand them on an empty page.
  const me = await getMe(token);
  const entitlementLevel = me?.entitlementLevel ?? "starter";
  const isPlatformUser = ["premium", "platform", "team"].includes(entitlementLevel);
  if (!isPlatformUser) redirect("/dashboard");

  // Enterprise Risk Workspace reskin (ERIP Package 1/2) — DARK (default off).
  // When on, this page presents as "Review Suggested Links" in plain business
  // language (no "matcher", no raw signal IDs or match_reason codes). Off = the
  // legacy "Matcher queue", byte-for-byte. The engine query is unchanged either way.
  const workspace = process.env.SECURELOGIC_RISK_WORKSPACE_ENABLED === "true";

  const sp = await searchParams;
  const targetFilter = isTargetType(sp.target_type) ? sp.target_type : undefined;
  const sort = isSort(sp.sort) ? sp.sort : "created-desc";
  const offset = Number.isFinite(Number(sp.offset)) && Number(sp.offset) >= 0
    ? Math.floor(Number(sp.offset))
    : 0;

  // B4 — arrive scoped to the finding you came from, not in a 4000-row dump.
  // The engine route has filtered on signal_id since 20260505 and the API client
  // already sent it; this page was the only place that dropped it. An invalid
  // value is ignored rather than 400ing the whole queue — a bad deep link should
  // degrade to the full queue, not to an error page.
  const signalId = isUuid(sp.signal_id) ? sp.signal_id : undefined;

  const [listData, counts] = await Promise.all([
    getSignalMatchSuggestions(token, {
      status: "pending",
      target_type: targetFilter,
      signal_id: signalId,
      sort,
      limit: PAGE_SIZE,
      offset,
    }),
    getSignalMatchSuggestionCounts(token),
  ]);

  // The engine list endpoint already enriches each row with target_name and the
  // canonical Intelligence Event fields (event_title/severity/confidence/
  // canonical_key) via SUGGESTION_ENRICHED_SELECT. Those extra keys ride through
  // this spread at runtime; the workspace "Review Suggested Links" layout consumes
  // them (the legacy layout ignores them and still reads the absent signal_* names,
  // preserving its byte-for-byte flag-off behavior).
  const suggestions: EnrichedSuggestion[] = (listData?.suggestions ?? []).map(
    (s) => ({ ...s })
  );

  const totalPending = counts?.total ?? 0;
  const lifetimeTotal = counts?.lifetime_total ?? 0;
  const breakdown = counts?.by_target_type ?? {
    vendor: 0,
    ai_system: 0,
    control: 0,
    obligation: 0,
  };

  const filtersActive = targetFilter !== undefined;

  // First-time-empty: this org has never seen a suggestion. Distinguish
  // from filtered-empty using lifetime_total from /counts.
  const isFirstTimeEmpty = lifetimeTotal === 0;

  const emptyState = isFirstTimeEmpty ? (
    <div
      style={{
        padding: 32,
        textAlign: "center",
        border: "1px dashed rgba(255,255,255,0.12)",
        borderRadius: 12,
        color: "#9ca3af",
      }}
    >
      <h2 style={{ fontSize: 18, color: "#e5e7eb", marginBottom: 8 }}>
        {workspace ? "Nothing to review yet" : "No suggestions yet"}
      </h2>
      <p style={{ fontSize: 14, lineHeight: 1.6, maxWidth: 480, margin: "0 auto" }}>
        {workspace
          ? "SecureLogic hasn't found any links between external intelligence and your vendors, AI systems, controls, or obligations yet. Suggested links appear here as new intelligence arrives."
          : "The matcher hasn't produced any suggested links between external signals and your vendors, AI systems, controls, or obligations yet. New suggestions appear here as the matcher runs."}
      </p>
    </div>
  ) : (
    <div
      style={{
        padding: 24,
        textAlign: "center",
        border: "1px dashed rgba(255,255,255,0.12)",
        borderRadius: 12,
        color: "#9ca3af",
      }}
    >
      <p style={{ fontSize: 14 }}>
        {workspace
          ? "No suggested links match the current filters."
          : "No pending suggestions match the current filters."}
        {filtersActive ? (
          <>
            {" "}
            <Link href="/queue" style={{ color: "#60a5fa" }}>
              Clear filters
            </Link>
          </>
        ) : null}
      </p>
    </div>
  );

  const pageStart = offset + 1;
  const pageEnd = offset + (listData?.count ?? 0);
  const hasNext = pageEnd < totalPending;
  const hasPrev = offset > 0;

  // Every /queue link on this page goes through buildQueueHref, so the finding
  // scope survives paging, sorting and the filter chips. It used to be rebuilt
  // ad hoc in three places, which is how the scope got dropped in the first place.
  function pageHref(nextOffset: number) {
    return buildQueueHref({ targetType: targetFilter, signalId, sort, offset: nextOffset });
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-12">
      <div className="mb-6 flex items-baseline justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "#f1f5f9" }}>
            {workspace ? "Review Suggested Links" : "Matcher queue"}
          </h1>
          <p className="text-sm mt-1" style={{ color: "#94a3b8" }}>
            {workspace
              ? "SecureLogic found possible links between external intelligence and your vendors, AI systems, controls, and obligations. Accept to confirm a link, or dismiss it."
              : "Pending suggested links between external signals and your entities. Accept to create the link, dismiss to ignore."}
            {totalPending > 0
              ? workspace
                ? ` ${totalPending} to review.`
                : ` ${totalPending} pending.`
              : ""}
          </p>
        </div>
      </div>

      {/* Scoped arrival (B4). Say so plainly, and always offer the way out —
          a scope the user cannot see or escape is just a differently-shaped trap
          from the 4000-row dump it replaces. */}
      {signalId && (
        <div
          className="mb-4 px-4 py-3 rounded-lg flex items-baseline justify-between gap-4 flex-wrap"
          style={{
            background: "rgba(59,130,246,0.08)",
            border: "1px solid rgba(59,130,246,0.25)",
          }}
        >
          <p className="text-sm m-0" style={{ color: "#bfdbfe" }}>
            Showing only the suggested links for the finding you came from.
          </p>
          <Link href="/queue" className="text-sm font-medium" style={{ color: "#93c5fd" }}>
            Show all pending suggestions →
          </Link>
        </div>
      )}

      {/* Filter chips — target_type. Each chip is a server-rendered link
          carrying the active sort/offset reset to 0. */}
      {(totalPending > 0 || filtersActive) && (
        <div className="mb-4 flex items-center gap-2 flex-wrap">
          <Link
            // "All types" clears target_type but KEEPS the finding scope. Was a
            // regex strip of pageHref(0), which mangled the query string.
            href={buildQueueHref({ signalId, sort })}
            style={{
              padding: "4px 12px",
              borderRadius: 999,
              fontSize: 12,
              border: "1px solid",
              borderColor: !filtersActive ? "#2563eb" : "rgba(255,255,255,0.12)",
              color: !filtersActive ? "#93c5fd" : "#9ca3af",
              textDecoration: "none",
            }}
          >
            All ({totalPending})
          </Link>
          {TARGET_TYPES.map((t) => {
            const active = targetFilter === t;
            return (
              <Link
                key={t}
                href={buildQueueHref({ targetType: t, signalId, sort })}
                style={{
                  padding: "4px 12px",
                  borderRadius: 999,
                  fontSize: 12,
                  border: "1px solid",
                  borderColor: active ? "#2563eb" : "rgba(255,255,255,0.12)",
                  color: active ? "#93c5fd" : "#9ca3af",
                  textDecoration: "none",
                }}
              >
                {TARGET_LABEL[t]} ({breakdown[t]})
              </Link>
            );
          })}
        </div>
      )}

      {/* Sort dropdown — server-rendered links per sort key. */}
      {totalPending > 0 && (
        <div
          className="mb-6 flex items-center gap-2 flex-wrap"
          style={{ fontSize: 12, color: "#9ca3af" }}
        >
          <span>Sort:</span>
          {(["created-desc", "score-desc"] as const).map((key) => {
            const qs = new URLSearchParams();
            if (targetFilter) qs.set("target_type", targetFilter);
            if (key !== "created-desc") qs.set("sort", key);
            const href = qs.toString() ? `/queue?${qs.toString()}` : "/queue";
            return (
              <Link
                key={key}
                href={href}
                style={{
                  padding: "2px 8px",
                  borderRadius: 4,
                  textDecoration: "none",
                  color: sort === key ? "#e5e7eb" : "#9ca3af",
                  background: sort === key ? "rgba(255,255,255,0.06)" : "transparent",
                }}
              >
                {(workspace ? WORKSPACE_SORT_LABEL : SORT_LABEL)[key]}
              </Link>
            );
          })}
        </div>
      )}

      <SuggestionList
        initialSuggestions={suggestions}
        emptyState={emptyState}
        workspace={workspace}
      />

      {totalPending > PAGE_SIZE && (
        <div
          className="mt-6 flex items-center justify-between"
          style={{ fontSize: 13, color: "#9ca3af" }}
        >
          <span>
            Showing {pageStart}–{pageEnd} of {totalPending}
          </span>
          <div className="flex items-center gap-3">
            {hasPrev ? (
              <Link
                href={pageHref(Math.max(0, offset - PAGE_SIZE))}
                style={{ color: "#60a5fa", textDecoration: "none" }}
              >
                ← Previous
              </Link>
            ) : (
              <span style={{ color: "#475569" }}>← Previous</span>
            )}
            {hasNext ? (
              <Link
                href={pageHref(offset + PAGE_SIZE)}
                style={{ color: "#60a5fa", textDecoration: "none" }}
              >
                Next →
              </Link>
            ) : (
              <span style={{ color: "#475569" }}>Next →</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
