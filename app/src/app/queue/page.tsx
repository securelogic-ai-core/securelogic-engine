import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
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

  const sp = await searchParams;
  const targetFilter = isTargetType(sp.target_type) ? sp.target_type : undefined;
  const sort = isSort(sp.sort) ? sp.sort : "created-desc";
  const offset = Number.isFinite(Number(sp.offset)) && Number(sp.offset) >= 0
    ? Math.floor(Number(sp.offset))
    : 0;

  const [listData, counts] = await Promise.all([
    getSignalMatchSuggestions(token, {
      status: "pending",
      target_type: targetFilter,
      sort,
      limit: PAGE_SIZE,
      offset,
    }),
    getSignalMatchSuggestionCounts(token),
  ]);

  // The list/counts endpoints don't (yet) join entity-name or signal-title.
  // We pass the raw rows through as EnrichedSuggestion-compatible shapes;
  // when a future package adds server-side enrichment, replace this map.
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
        No suggestions yet
      </h2>
      <p style={{ fontSize: 14, lineHeight: 1.6, maxWidth: 480, margin: "0 auto" }}>
        The matcher hasn&apos;t produced any suggested links between external
        signals and your vendors, AI systems, controls, or obligations yet.
        New suggestions appear here as the matcher runs.
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
        No pending suggestions match the current filters.
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

  function pageHref(nextOffset: number) {
    const qs = new URLSearchParams();
    if (targetFilter) qs.set("target_type", targetFilter);
    if (sort !== "created-desc") qs.set("sort", sort);
    if (nextOffset > 0) qs.set("offset", String(nextOffset));
    const s = qs.toString();
    return s ? `/queue?${s}` : "/queue";
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-12">
      <div className="mb-6 flex items-baseline justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "#f1f5f9" }}>
            Matcher queue
          </h1>
          <p className="text-sm mt-1" style={{ color: "#94a3b8" }}>
            Pending suggested links between external signals and your
            entities. Accept to create the link, dismiss to ignore.
            {totalPending > 0 ? ` ${totalPending} pending.` : ""}
          </p>
        </div>
      </div>

      {/* Filter chips — target_type. Each chip is a server-rendered link
          carrying the active sort/offset reset to 0. */}
      {(totalPending > 0 || filtersActive) && (
        <div className="mb-4 flex items-center gap-2 flex-wrap">
          <Link
            href={pageHref(0).replace(/[?&]target_type=[^&]+/, "") || "/queue"}
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
            const qs = new URLSearchParams();
            qs.set("target_type", t);
            if (sort !== "created-desc") qs.set("sort", sort);
            return (
              <Link
                key={t}
                href={`/queue?${qs.toString()}`}
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
                {SORT_LABEL[key]}
              </Link>
            );
          })}
        </div>
      )}

      <SuggestionList
        initialSuggestions={suggestions}
        emptyState={emptyState}
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
