/**
 * BriefItemPlatformContext — renders an Intelligence Brief item's
 * personalization matches ("this affects YOUR vendor/AI system/risk/
 * obligation") as links into the tenant's own records.
 *
 * The engine has computed and stored these matches at generation time since
 * 20260511; EG2 slice 6 finally returns and renders them. This is the visible
 * proof the Brief is connected to the customer's context rather than being a
 * publication — every chip lands on the canonical record it names.
 */

import Link from "next/link";
import type { IntelligenceBriefItem } from "@/lib/api";

type MatchLink = { href: string; label: string; kind: string };

/** Flatten platform_context into ordered, deduped links (vendors first). */
export function platformContextLinks(
  ctx: IntelligenceBriefItem["platform_context"]
): MatchLink[] {
  if (!ctx) return [];
  const links: MatchLink[] = [];
  for (const v of ctx.matched_vendors ?? []) {
    links.push({ href: `/vendors/${v.id}`, label: v.name, kind: "Your vendor" });
  }
  for (const s of ctx.matched_ai_systems ?? []) {
    links.push({ href: `/ai-systems/${s.id}`, label: s.name, kind: "Your AI system" });
  }
  for (const r of ctx.matched_risks ?? []) {
    links.push({ href: `/risks/${r.id}`, label: r.title, kind: "Open risk" });
  }
  for (const o of ctx.matched_obligations ?? []) {
    links.push({ href: `/obligations/${o.id}`, label: o.title, kind: "Obligation" });
  }
  return links;
}

/** Compact strip for item cards: "Affects your vendor: Cisco →" (first match + count). */
export function BriefItemContextStrip({ item }: { item: IntelligenceBriefItem }) {
  const links = platformContextLinks(item.platform_context);
  if (!item.is_personalized || links.length === 0) return null;
  const first = links[0]!;
  const more = links.length - 1;

  return (
    <div
      className="mb-4 flex items-center gap-2 rounded-lg px-3.5 py-2.5 border"
      style={{ background: "rgba(0,196,180,0.08)", borderColor: "rgba(0,196,180,0.25)" }}
      data-brief-context-strip
    >
      <span className="text-xs font-bold uppercase tracking-wide flex-shrink-0" style={{ color: "#00c4b4" }}>
        Affects {first.kind.toLowerCase()}
      </span>
      <Link
        href={first.href}
        className="text-xs font-semibold truncate hover:underline"
        style={{ color: "#5eead4" }}
      >
        {first.label} →
      </Link>
      {more > 0 && (
        <span className="text-xs flex-shrink-0" style={{ color: "#64748b" }}>
          +{more} more in your inventory
        </span>
      )}
    </div>
  );
}

/** Full callout for the item detail page: every match, grouped and linked. */
export function BriefItemContextCallout({ item }: { item: IntelligenceBriefItem }) {
  const links = platformContextLinks(item.platform_context);
  if (!item.is_personalized || links.length === 0) return null;

  return (
    <div
      className="rounded-xl border p-5 mb-6"
      style={{ background: "rgba(0,196,180,0.08)", borderColor: "rgba(0,196,180,0.25)" }}
      data-brief-context-callout
    >
      <p className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: "#00c4b4" }}>
        Why this reached you — matches in your environment
      </p>
      <ul className="space-y-1.5">
        {links.map((l) => (
          <li key={l.href} className="flex items-baseline gap-2 text-sm">
            <span className="text-xs flex-shrink-0" style={{ color: "#64748b" }}>
              {l.kind}
            </span>
            <Link href={l.href} className="font-medium hover:underline" style={{ color: "#5eead4" }}>
              {l.label} →
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
