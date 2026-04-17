import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getFrameworks, getFrameworkReadiness, type Framework, type FrameworkReadiness } from "@/lib/api";
import { ActivateButton } from "./ActivateButton";

// ─────────────────────────────────────────────────────────────
// Template metadata (display only — not persisted in DB)
// ─────────────────────────────────────────────────────────────

const TEMPLATES: Array<{
  key: string;
  name: string;
  version: string;
  description: string;
  requirementCount: number;
}> = [
  {
    key: "soc2",
    name: "SOC 2 Type II",
    version: "2017",
    description: "AICPA trust service criteria covering security, availability, processing integrity, confidentiality, and privacy.",
    requirementCount: 36,
  },
  {
    key: "nist_csf",
    name: "NIST Cybersecurity Framework",
    version: "1.1",
    description: "Five core functions — Identify, Protect, Detect, Respond, Recover — for managing cybersecurity risk.",
    requirementCount: 56,
  },
  {
    key: "iso27001",
    name: "ISO/IEC 27001",
    version: "2022",
    description: "International standard for information security management systems with 93 Annex A controls.",
    requirementCount: 93,
  },
  {
    key: "hipaa",
    name: "HIPAA Security Rule",
    version: "2024",
    description: "Administrative, physical, and technical safeguards for electronic protected health information.",
    requirementCount: 42,
  },
];

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
}: {
  framework: Framework;
  readiness: FrameworkReadiness | null;
}) {
  return (
    <Link
      href={`/frameworks/${framework.id}`}
      className="block bg-brand-surface border border-brand-line rounded-xl p-5 hover:border-teal-800/60 transition-colors"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold truncate" style={{ color: "#f1f5f9" }}>
            {framework.name}
          </p>
          <p className="text-xs mt-0.5" style={{ color: "#475569" }}>
            v{framework.version}
          </p>
        </div>
        <span
          className="flex-shrink-0 inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold"
          style={{ background: "rgba(34,197,94,0.15)", color: "#86efac" }}
        >
          Active
        </span>
      </div>

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
        {isActive && (
          <span
            className="flex-shrink-0 inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold"
            style={{ background: "rgba(34,197,94,0.15)", color: "#86efac" }}
          >
            Active ✓
          </span>
        )}
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

  // Determine which template keys are already active
  const activeKeys = new Set<string>();
  for (const f of frameworks) {
    for (const t of TEMPLATES) {
      if (f.name === t.name && f.version === t.version) {
        activeKeys.add(t.key);
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
