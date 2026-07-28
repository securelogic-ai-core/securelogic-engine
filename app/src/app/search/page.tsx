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
          autoFocus
          minLength={2}
          maxLength={200}
          className="w-full px-4 py-3 rounded-xl text-sm text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-teal-600"
          style={{ background: "#0f172a", border: "1px solid #1e293b" }}
        />
      </form>

      {query && results && results.total === 0 && (
        <div className="px-4 py-8 text-center text-sm text-slate-400" style={CARD_STYLE}>
          No results for “{query}”.
        </div>
      )}

      {query && !results && (
        <div className="px-4 py-8 text-center text-sm text-slate-400" style={CARD_STYLE}>
          Search is unavailable right now. Try again in a moment.
        </div>
      )}

      {results && results.total > 0 && (
        <div className="flex flex-col gap-6">
          {TYPE_ORDER.filter((t) => grouped.has(t)).map((type) => (
            <section key={type}>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">
                {TYPE_LABELS[type]}
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
