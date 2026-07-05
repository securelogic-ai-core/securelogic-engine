import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getEnterpriseEntities } from "@/lib/api";
import {
  ENTITY_TYPES,
  ENTITY_PAGE,
  type EntityType,
  type EnterpriseEntity,
} from "@/lib/enterpriseContext";
import {
  entityTypeLabel,
  pageNav,
  parseOffsetParam,
  readFailure,
} from "@/lib/enterpriseContextFormat";
import {
  CriticalityBadge,
  EntityTypeChip,
  MetaChip,
  ReadFailurePanel,
  StatusChip,
} from "./shared";

function isEntityType(v: string | undefined): v is EntityType {
  return !!v && (ENTITY_TYPES as readonly string[]).includes(v);
}

export default async function EnterpriseContextPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const entitlementLevel = session.entitlementLevel ?? "free";
  const isPlatformUser =
    entitlementLevel === "premium" ||
    entitlementLevel === "platform" ||
    entitlementLevel === "team";
  if (!isPlatformUser) redirect("/dashboard");

  const sp = await searchParams;
  const typeFilter = isEntityType(sp.entity_type) ? sp.entity_type : undefined;
  const offset = parseOffsetParam(sp.offset);
  const limit = ENTITY_PAGE.defaultLimit;

  const result = await getEnterpriseEntities(token, {
    entity_type: typeFilter,
    limit,
    offset,
  });

  const filterHref = (t?: EntityType) => {
    const q = new URLSearchParams();
    if (t) q.set("entity_type", t);
    const s = q.toString();
    return s ? `/enterprise-context?${s}` : "/enterprise-context";
  };
  const pageHref = (o: number) => {
    const q = new URLSearchParams();
    if (typeFilter) q.set("entity_type", typeFilter);
    if (o > 0) q.set("offset", String(o));
    const s = q.toString();
    return s ? `/enterprise-context?${s}` : "/enterprise-context";
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-12">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: "#f1f5f9" }}>
            Enterprise Context
          </h1>
          <p className="text-sm mt-1" style={{ color: "#94a3b8" }}>
            The assets, applications, services, and organizational structure your risk
            picture is built on.
          </p>
        </div>
        {result.ok && (
          <div className="flex items-center gap-3 flex-shrink-0">
            <Link
              href="/enterprise-context/import"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium border transition-colors hover:opacity-80"
              style={{ borderColor: "#1e293b", color: "#94a3b8" }}
            >
              ↑ Import CSV
            </Link>
            <Link
              href="/enterprise-context/entities/new"
              className="px-4 py-2 rounded-lg text-sm font-semibold transition-colors hover:opacity-90"
              style={{ background: "#00c4b4", color: "#0a0f1a" }}
            >
              Add Entity
            </Link>
          </div>
        )}
      </div>

      {!result.ok ? (
        <ReadFailurePanel {...readFailure(result)} />
      ) : (
        <>
          {/* Type filter chips */}
          <div className="mb-5 flex flex-wrap gap-2">
            <FilterChip href={filterHref(undefined)} active={!typeFilter} label="All" />
            {ENTITY_TYPES.map((t) => (
              <FilterChip
                key={t}
                href={filterHref(t)}
                active={typeFilter === t}
                label={entityTypeLabel(t)}
              />
            ))}
          </div>

          {result.enterprise_entities.length === 0 ? (
            <div className="bg-brand-surface border border-brand-line rounded-xl p-8 text-center">
              <p className="text-sm mb-3" style={{ color: "#94a3b8" }}>
                {offset > 0
                  ? "No more entities."
                  : typeFilter
                  ? `No ${entityTypeLabel(typeFilter).toLowerCase()} entities yet.`
                  : "No entities registered yet."}
              </p>
              {offset === 0 && (
                <Link
                  href="/enterprise-context/entities/new"
                  className="inline-flex items-center px-4 py-2 rounded-lg text-sm font-semibold transition-colors hover:opacity-90"
                  style={{ background: "#00c4b4", color: "#0a0f1a" }}
                >
                  Add Entity
                </Link>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {result.enterprise_entities.map((entity) => (
                <Link
                  key={entity.id}
                  href={`/enterprise-context/entities/${entity.id}`}
                  className="block hover:border-slate-500 cursor-pointer transition-colors rounded-xl"
                >
                  <EntityRow entity={entity} />
                </Link>
              ))}
            </div>
          )}

          <Pagination
            offset={offset}
            limit={limit}
            receivedCount={result.enterprise_entities.length}
            pageHref={pageHref}
          />
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────

function FilterChip({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className="px-3 py-1 rounded-full text-xs font-medium border transition-colors hover:opacity-80"
      style={
        active
          ? { background: "rgba(0,196,180,0.15)", borderColor: "rgba(0,196,180,0.4)", color: "#5eead4" }
          : { background: "transparent", borderColor: "#1e293b", color: "#94a3b8" }
      }
    >
      {label}
    </Link>
  );
}

function EntityRow({ entity }: { entity: EnterpriseEntity }) {
  return (
    <div className="bg-brand-surface border border-brand-line rounded-xl p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold truncate" style={{ color: "#f1f5f9" }}>
              {entity.name}
            </span>
            <EntityTypeChip value={entity.entity_type} />
            <CriticalityBadge value={entity.criticality} />
            <StatusChip value={entity.status} />
          </div>
          {entity.description && (
            <p className="mt-1 text-xs line-clamp-2" style={{ color: "#94a3b8" }}>
              {entity.description}
            </p>
          )}
          <div className="mt-2 flex flex-wrap gap-3">
            <MetaChip label="Confidence" value={entity.confidence} />
            <MetaChip label="Source" value={entity.source_type} />
            <MetaChip label="Ref" value={entity.external_ref} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Pagination({
  offset,
  limit,
  receivedCount,
  pageHref,
}: {
  offset: number;
  limit: number;
  receivedCount: number;
  pageHref: (o: number) => string;
}) {
  const { prevOffset, nextOffset } = pageNav(offset, limit, receivedCount);
  if (prevOffset === null && nextOffset === null) return null;
  const linkClass =
    "px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors hover:opacity-80";
  const linkStyle = { borderColor: "#1e293b", color: "#94a3b8" };
  return (
    <div className="mt-6 flex items-center justify-between">
      <div>
        {prevOffset !== null && (
          <Link href={pageHref(prevOffset)} className={linkClass} style={linkStyle}>
            ← Previous
          </Link>
        )}
      </div>
      <div>
        {nextOffset !== null && (
          <Link href={pageHref(nextOffset)} className={linkClass} style={linkStyle}>
            Next →
          </Link>
        )}
      </div>
    </div>
  );
}
