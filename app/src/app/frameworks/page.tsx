import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getFrameworks, getFrameworkReadiness, type Framework, type FrameworkReadiness } from "@/lib/api";
import { ActivateButton } from "./ActivateButton";
import { DeactivateButton } from "./DeactivateButton";

// ─────────────────────────────────────────────────────────────
// Template metadata (display only — not persisted in DB)
// ─────────────────────────────────────────────────────────────

type Category = "Cybersecurity" | "Privacy" | "Financial" | "AI Governance";

const TEMPLATES: Array<{
  key: string;
  name: string;
  version: string;
  description: string;
  requirementCount: number;
  category: Category;
}> = [
  // ── Cybersecurity ──────────────────────────────────────────
  {
    key: "soc2",
    name: "SOC 2 Type II",
    version: "2017",
    description: "AICPA trust service criteria covering security, availability, processing integrity, confidentiality, and privacy.",
    requirementCount: 36,
    category: "Cybersecurity",
  },
  {
    key: "nist_csf",
    name: "NIST Cybersecurity Framework",
    version: "1.1",
    description: "Five core functions — Identify, Protect, Detect, Respond, Recover — for managing cybersecurity risk.",
    requirementCount: 57,
    category: "Cybersecurity",
  },
  {
    key: "iso27001",
    name: "ISO/IEC 27001",
    version: "2022",
    description: "International standard for information security management systems with 93 Annex A controls.",
    requirementCount: 93,
    category: "Cybersecurity",
  },
  {
    key: "hipaa",
    name: "HIPAA Security Rule",
    version: "2024",
    description: "Administrative, physical, and technical safeguards for electronic protected health information.",
    requirementCount: 42,
    category: "Cybersecurity",
  },
  {
    key: "pci_dss",
    name: "PCI DSS",
    version: "4.0",
    description: "Payment Card Industry Data Security Standard — 12 requirements for protecting cardholder data.",
    requirementCount: 12,
    category: "Cybersecurity",
  },
  {
    key: "nist_800_53",
    name: "NIST SP 800-53",
    version: "Rev 5",
    description: "Security and privacy controls for federal information systems across 20 control families.",
    requirementCount: 20,
    category: "Cybersecurity",
  },
  {
    key: "cis_v8",
    name: "CIS Controls",
    version: "v8",
    description: "18 prioritized safeguards to defend against the most prevalent cyber attacks.",
    requirementCount: 18,
    category: "Cybersecurity",
  },
  // ── Privacy ────────────────────────────────────────────────
  {
    key: "gdpr",
    name: "GDPR",
    version: "2018",
    description: "EU General Data Protection Regulation — 12 key articles covering lawful processing, data subject rights, and breach notification.",
    requirementCount: 12,
    category: "Privacy",
  },
  {
    key: "ccpa",
    name: "CCPA / CPRA",
    version: "2023",
    description: "California Consumer Privacy Act and Privacy Rights Act — 8 consumer rights and organizational obligations.",
    requirementCount: 8,
    category: "Privacy",
  },
  // ── Financial ──────────────────────────────────────────────
  {
    key: "sox",
    name: "SOX IT Controls",
    version: "2002",
    description: "Sarbanes-Oxley Act IT general controls covering access, change management, and operations for financial reporting integrity.",
    requirementCount: 8,
    category: "Financial",
  },
  {
    key: "dora",
    name: "DORA",
    version: "2025",
    description: "EU Digital Operational Resilience Act — 10 requirements for ICT risk, incident management, and third-party oversight.",
    requirementCount: 10,
    category: "Financial",
  },
  // ── AI Governance ──────────────────────────────────────────
  {
    key: "nist_ai_rmf",
    name: "NIST AI RMF",
    version: "1.0",
    description: "NIST Artificial Intelligence Risk Management Framework — 4 core functions: Govern, Map, Measure, Manage.",
    requirementCount: 4,
    category: "AI Governance",
  },
];

// ─────────────────────────────────────────────────────────────
// Category badge styles
// ─────────────────────────────────────────────────────────────

const CATEGORY_STYLES: Record<Category, React.CSSProperties> = {
  Cybersecurity:  { background: "rgba(59,130,246,0.12)",  color: "#93c5fd" },
  Privacy:        { background: "rgba(168,85,247,0.12)",  color: "#d8b4fe" },
  Financial:      { background: "rgba(34,197,94,0.12)",   color: "#86efac" },
  "AI Governance":{ background: "rgba(249,115,22,0.12)",  color: "#fdba74" },
};

function CategoryBadge({ category }: { category: Category }) {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
      style={CATEGORY_STYLES[category]}
    >
      {category}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// Readiness bar
// ─────────────────────────────────────────────────────────────

function ReadinessBar({ score }: { score: number }) {
  const color =
    score >= 75 ? "#22c55e" :
    score >= 50 ? "#f59e0b" :
    score >= 25 ? "#f97316" :
    "#ef4444";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 rounded-full h-1.5" style={{ background: "rgba(255,255,255,0.08)" }}>
        <div
          className="h-1.5 rounded-full transition-all"
          style={{ width: `${score}%`, background: color }}
        />
      </div>
      <span className="text-xs font-bold tabular-nums w-9 text-right" style={{ color }}>
        {score}%
      </span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Active framework card
// ─────────────────────────────────────────────────────────────

function ActiveFrameworkCard({
  framework,
  readiness,
  category,
  isAdmin,
}: {
  framework: Framework;
  readiness: FrameworkReadiness | null;
  category: Category | null;
  isAdmin: boolean;
}) {
  return (
    <div className="bg-brand-surface border border-brand-line rounded-xl p-5 hover:border-teal-800/60 transition-colors">
      <div className="flex items-start justify-between gap-3 mb-3">
        <Link href={`/frameworks/${framework.id}`} className="min-w-0 flex-1 block">
          <p className="text-sm font-semibold truncate" style={{ color: "#f1f5f9" }}>
            {framework.name}
          </p>
          <p className="text-xs mt-0.5" style={{ color: "#475569" }}>
            v{framework.version}
          </p>
        </Link>
        <div className="flex items-center gap-2 flex-shrink-0">
          {category && <CategoryBadge category={category} />}
          <span
            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold"
            style={{ background: "rgba(34,197,94,0.15)", color: "#86efac" }}
          >
            Active
          </span>
          {isAdmin && (
            <DeactivateButton
              frameworkId={framework.id}
              frameworkName={framework.name}
            />
          )}
        </div>
      </div>

      <Link href={`/frameworks/${framework.id}`} className="block">
        {readiness ? (
          <div className="space-y-2">
            <ReadinessBar score={readiness.readiness_score} />
            <div className="flex gap-4 text-xs" style={{ color: "#475569" }}>
              <span>
                <span className="font-medium" style={{ color: "#86efac" }}>{readiness.satisfied}</span> satisfied
              </span>
              <span>
                <span className="font-medium" style={{ color: "#fcd34d" }}>{readiness.partial}</span> partial
              </span>
              <span>
                <span className="font-medium" style={{ color: "#94a3b8" }}>{readiness.unmapped}</span> unmapped
              </span>
            </div>
          </div>
        ) : (
          <p className="text-xs" style={{ color: "#475569" }}>
            {readiness === null ? "Loading readiness…" : "No requirements yet"}
          </p>
        )}
      </Link>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Template card
// ─────────────────────────────────────────────────────────────

function TemplateCard({
  template,
  isActive,
}: {
  template: (typeof TEMPLATES)[number];
  isActive: boolean;
}) {
  return (
    <div
      className="bg-brand-surface border border-brand-line rounded-xl p-5"
      style={isActive ? { borderColor: "rgba(34,197,94,0.25)" } : undefined}
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold" style={{ color: "#f1f5f9" }}>
            {template.name}
          </p>
          <p className="text-xs mt-0.5" style={{ color: "#475569" }}>
            v{template.version} · {template.requirementCount} requirements
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <CategoryBadge category={template.category} />
          {isActive && (
            <span
              className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold"
              style={{ background: "rgba(34,197,94,0.15)", color: "#86efac" }}
            >
              Active ✓
            </span>
          )}
        </div>
      </div>
      <p className="text-xs leading-relaxed mb-4" style={{ color: "#94a3b8" }}>
        {template.description}
      </p>
      {isActive ? (
        <p className="text-xs font-medium" style={{ color: "#475569" }}>
          Already activated
        </p>
      ) : (
        <ActivateButton templateKey={template.key} frameworkName={template.name} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────

export default async function FrameworksPage() {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const isAdmin = session.userRole === "admin";

  const frameworksData = await getFrameworks(token);
  const frameworks = frameworksData?.frameworks ?? [];

  // Fetch readiness for each active framework in parallel
  const readinessResults = await Promise.all(
    frameworks.map((f) => getFrameworkReadiness(token, f.id))
  );
  const readinessByFrameworkId = new Map<string, FrameworkReadiness>();
  frameworks.forEach((f, i) => {
    const r = readinessResults[i];
    if (r) readinessByFrameworkId.set(f.id, r);
  });

  // Determine which template keys are already active, and build a lookup for category
  const activeKeys = new Set<string>();
  const categoryByFrameworkId = new Map<string, Category>();
  for (const f of frameworks) {
    for (const t of TEMPLATES) {
      if (f.name === t.name && f.version === t.version) {
        activeKeys.add(t.key);
        categoryByFrameworkId.set(f.id, t.category);
      }
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">
      {/* Header */}
      <div className="mb-10">
        <h1 className="text-2xl font-bold mb-1" style={{ color: "#f1f5f9" }}>
          Frameworks
        </h1>
        <p className="text-sm" style={{ color: "#94a3b8" }}>
          Activate compliance frameworks and track readiness against mapped controls.
        </p>
      </div>

      {/* Active frameworks */}
      {frameworks.length > 0 && (
        <section className="mb-10">
          <h2 className="text-xs font-semibold uppercase tracking-wide mb-4" style={{ color: "#94a3b8" }}>
            Active Frameworks
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {frameworks.map((f) => (
              <ActiveFrameworkCard
                key={f.id}
                framework={f}
                readiness={readinessByFrameworkId.get(f.id) ?? null}
                category={categoryByFrameworkId.get(f.id) ?? null}
                isAdmin={isAdmin}
              />
            ))}
          </div>
        </section>
      )}

      {/* Template library */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wide mb-4" style={{ color: "#94a3b8" }}>
          {frameworks.length > 0 ? "Framework Templates" : "Available Frameworks"}
        </h2>
        {frameworks.length === 0 && (
          <p className="text-sm mb-6" style={{ color: "#475569" }}>
            No frameworks activated yet. Activate a template to start tracking compliance readiness.
          </p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {TEMPLATES.map((t) => (
            <TemplateCard key={t.key} template={t} isActive={activeKeys.has(t.key)} />
          ))}
        </div>
      </section>
    </div>
  );
}
