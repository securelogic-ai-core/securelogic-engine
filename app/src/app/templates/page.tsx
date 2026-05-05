import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getSession } from "@/lib/session";
import { getIndustryTemplates } from "@/lib/api";

export default async function TemplatesIndexPage() {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const data = await getIndustryTemplates(token);
  // Engine returns 404 when the env-var gate is closed. Surface it as a
  // Next.js 404 so the page is invisible to callers who don't have the
  // feature enabled.
  if (!data) notFound();

  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      <div className="mb-8">
        <h1 className="text-2xl font-bold" style={{ color: "#f1f5f9" }}>
          Industry starter templates
        </h1>
        <p className="text-sm mt-2" style={{ color: "#94a3b8" }}>
          Pre-built bundles of vendors, obligations, and controls scoped to
          common industries. Pick one, preview the contents, and load into
          your inventory. Loaded rows are fully editable and additive — they
          will not overwrite anything you already have.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {data.templates.map((t) => (
          <Link
            key={t.id}
            href={`/templates/${t.id}`}
            style={{
              display: "block",
              padding: 20,
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 12,
              textDecoration: "none",
              color: "inherit",
            }}
          >
            <h2 style={{ fontSize: 16, fontWeight: 600, color: "#f1f5f9", marginBottom: 8 }}>
              {t.name}
            </h2>
            <p style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.5, marginBottom: 16 }}>
              {t.description}
            </p>
            <div style={{ display: "flex", gap: 16, fontSize: 12, color: "#9ca3af", flexWrap: "wrap" }}>
              <span>{t.counts.vendors} vendors</span>
              <span>{t.counts.obligations} obligations</span>
              <span>{t.counts.controls} controls</span>
            </div>
            {t.review_blocked && (
              <div
                style={{
                  marginTop: 12,
                  padding: "4px 8px",
                  fontSize: 11,
                  display: "inline-block",
                  background: "rgba(245,158,11,0.08)",
                  color: "#fcd34d",
                  border: "1px solid rgba(245,158,11,0.2)",
                  borderRadius: 4,
                }}
              >
                Some entries flagged for review
              </div>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
