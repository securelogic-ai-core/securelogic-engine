import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { getMe, searchGlobal, type GlobalSearchHit } from "@/lib/api";

// Server-rendered on every request (session + live engine data); the GET form
// round-trips through ?q= so search works without any client JS.

const TYPE_LABELS: Record<GlobalSearchHit["type"], string> = {
  finding:    "Findings",
  risk:       "Risks",
  vendor:     "Vendors",
  ai_system:  "AI Systems",
  control:    "Controls",
  obligation: "Obligations",
  asset:      "Assets",
};

// Section order mirrors the enterprise workflow: work objects first
// (findings, risks), then the assessed inventory, then compliance objects.
const TYPE_ORDER: ReadonlyArray<GlobalSearchHit["type"]> = [
  "finding",
  "risk",
  "vendor",
  "ai_system",
  "asset",
  "control",
  "obligation",
];

// Mirror of the engine's PER_TYPE_LIMIT (globalSearch.ts): each category
// returns at most this many hits, and the response carries no true match
// count. A section AT the limit may therefore be truncated — the page must
// say so rather than let "5 rows" read as "5 matches exist".
const SEARCH_PER_TYPE_LIMIT = 5;

// Where each category's full workspace lives — the "keep going" path when
// search comes up empty or capped. Hrefs are the canonical list routes.
const TYPE_BROWSE: ReadonlyArray<{ label: string; href: string }> = [
  { label: "Findings",    href: "/findings" },
  { label: "Risks",       href: "/risks" },
  { label: "Vendors",     href: "/vendors" },
  { label: "AI Systems",  href: "/ai-systems" },
  { label: "Assets",      href: "/assets" },
  { label: "Controls",    href: "/controls" },
  { label: "Obligations", href: "/obligations" },
];

function BrowseChips() {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {TYPE_BROWSE.map(({ label, href }) => (
        <Link
          key={href}
          href={href}
          className="text-xs px-3 py-1.5 rounded-full transition-colors hover:bg-white/10"
          style={{ background: "#1e293b", color: "#94a3b8" }}
        >
          {label}
        </Link>
      ))}
    </div>
  );
}

const CARD_STYLE: React.CSSProperties = {
  background: "var(--color-brand-surface, #111827)",
  border: "1px solid #1e293b",
  borderRadius: "12px",
};

function HitRow({ hit }: { hit: GlobalSearchHit }) {
  return (
    <Link
      href={hit.href}
      className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-white/5"
    >
      <span className="text-sm text-slate-200 truncate">{hit.title}</span>
      {hit.subtitle && (
        <span
          className="text-xs px-2 py-0.5 rounded-full whitespace-nowrap"
          style={{ background: "#1e293b", color: "#94a3b8" }}
        >
          {hit.subtitle}
        </span>
      )}
    </Link>
  );
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const me = await getMe(token);
  const entitlementLevel = me?.entitlementLevel ?? "starter";
  const isPlatformUser = ["premium", "platform", "team"].includes(entitlementLevel);
  if (!isPlatformUser) redirect("/dashboard");

  const sp = await searchParams;
  const rawQuery = (sp.q ?? "").trim();
  // Mirror the engine's normalizeGlobalQuery bounds so we never send a request
  // the engine will 400.
  const query = rawQuery.length >= 2 && rawQuery.length <= 200 ? rawQuery : null;
  const results = query ? await searchGlobal(token, query) : null;

  const grouped = new Map<GlobalSearchHit["type"], GlobalSearchHit[]>();
  for (const hit of results?.hits ?? []) {
    const list = grouped.get(hit.type) ?? [];
    list.push(hit);
    grouped.set(hit.type, list);
  }

  return (
    <main className="max-w-3xl mx-auto px-6 py-10">
      <h1 className="text-2xl font-semibold text-white mb-1">Search</h1>
      <p className="text-sm text-slate-400 mb-6">
        Find findings, risks, vendors, AI systems, controls, obligations, and
        assets across your organization.
      </p>

      <form action="/search" method="get" className="mb-8">
        <input
          type="search"
          name="q"
          defaultValue={rawQuery}
          placeholder="Search by name or title…"
          aria-label="Search your organization by name or title"
          autoFocus
          minLength={2}
          maxLength={200}
          className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-teal-600"
          style={{ background: "#0f172a", border: "1px solid #1e293b" }}
        />
      </form>

      {!query && (
        <div className="px-6 py-8 text-center" style={CARD_STYLE}>
          <p className="text-sm text-slate-400 mb-4">
            Search spans every record your organization holds — or go straight
            to a workspace:
          </p>
          <BrowseChips />
        </div>
      )}

      {query && results && results.total === 0 && (
        <div className="px-6 py-8 text-center" style={CARD_STYLE}>
          <p className="text-sm text-slate-400 mb-1">No results for “{query}”.</p>
          <p className="text-xs text-slate-500 mb-4">
            Try a shorter term or a name prefix — search matches names and
            titles, not full text.
          </p>
          <BrowseChips />
        </div>
      )}

      {query && !results && (
        <div className="px-4 py-8 text-center text-sm text-slate-400" style={CARD_STYLE}>
          Search is unavailable right now. Try again in a moment.
        </div>
      )}

      {results && results.total > 0 && (
        <div className="flex flex-col gap-6">
          {/* The whole truth about what came back: total returned, and — when
              any category sits AT the engine's per-type cap — the fact that
              deeper matches may exist. Silent truncation teaches readers to
              distrust every count in the product. role="status" announces the
              outcome to screen readers after the no-JS form round-trip. */}
          <p role="status" className="text-sm text-slate-400 -mb-1">
            <span className="font-semibold text-slate-200">{results.total}</span>{" "}
            result{results.total !== 1 ? "s" : ""} for “{query}”
            {[...grouped.values()].some((l) => l.length >= SEARCH_PER_TYPE_LIMIT) && (
              <span className="text-slate-500">
                {" "}· showing the top {SEARCH_PER_TYPE_LIMIT} per category — refine
                your search to narrow
              </span>
            )}
          </p>
          {TYPE_ORDER.filter((t) => grouped.has(t)).map((type) => (
            <section key={type}>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                {TYPE_LABELS[type]}{" "}
                <span className="ml-1 font-medium text-slate-600 tracking-normal">
                  · {grouped.get(type)!.length}
                  {grouped.get(type)!.length >= SEARCH_PER_TYPE_LIMIT ? "+" : ""}
                </span>
              </h2>
              <div className="divide-y divide-slate-800" style={CARD_STYLE}>
                {grouped.get(type)!.map((hit) => (
                  <HitRow key={`${hit.type}:${hit.id}`} hit={hit} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
