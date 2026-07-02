import type { Metadata } from "next";
import Link from "next/link";
import { getPricingTiers } from "@/lib/pricing";

export const metadata: Metadata = {
  title: "Platform",
  description:
    "The SecureLogic AI platform — Intelligence, Vendor Risk, AI Governance, Compliance, and Executive Reporting modules for unified risk coverage.",
};

interface PlatformModule {
  id: string;
  name: string;
  badges: string[];
  problem: string;
  inputs: string[];
  automation: string[];
  outputs: string[];
  deliverables: string[];
  outcome: string;
  cta: { label: string; href: string; app?: boolean };
}

// Product-oriented module model: every capability states the Problem, the
// Inputs → Automation → Outputs workflow, the concrete Deliverables, and the
// Business outcome. Anchors (#intelligence, #vendor-risk, #ai-governance,
// #compliance) match the global nav; #executive-reporting is page-only.
function getPlatformModules(appUrl: string): PlatformModule[] {
  const trial = `${appUrl}/signup?plan=platform_annual`;
  return [
    {
      id: "intelligence",
      name: "Intelligence",
      badges: ["Available now"],
      problem:
        "Security leaders can't read every advisory, regulation, and breach report — and most feeds bury the few that actually touch their organization.",
      inputs: [
        "9 live threat, vulnerability & regulatory sources",
        "Your registered vendors and AI systems",
        "Your frameworks and obligations",
      ],
      automation: [
        "Deduplicate, normalize and qualify each signal",
        "Score severity and relevance to your org",
        "Synthesize an executive narrative with actions",
      ],
      outputs: [
        "Weekly executive Intelligence Brief",
        "Prioritized, scored signal list",
        "Why-it-matters + recommended action per item",
      ],
      deliverables: ["Weekly brief", "Signal archive & search", "Severity filtering"],
      outcome:
        "Leaders spend minutes, not hours — and act on the signals that actually touch their environment.",
      cta: { label: "Learn more about the Intelligence Brief", href: "/intelligence-brief/" },
    },
    {
      id: "vendor-risk",
      name: "Vendor Risk",
      badges: ["Available now", "Platform Professional"],
      problem:
        "Third-party and AI-vendor exposure is the fastest-growing attack surface, yet most teams track vendors in spreadsheets disconnected from real risk.",
      inputs: [
        "Vendor inventory and onboarding intake",
        "Assurance documents (SOC 2, ISO 27001)",
        "External signals touching each vendor",
      ],
      automation: [
        "Extract and assess assurance evidence",
        "Score inherent and residual risk",
        "Map findings to your risk register",
      ],
      outputs: [
        "Scored vendor register",
        "Assessment findings and gaps",
        "Risk-register entries with treatment",
      ],
      deliverables: ["Vendor inventory & onboarding", "Risk scoring & trending", "Document ingestion"],
      outcome:
        "See exactly where vendors fall short — and tie every finding to an owner and a treatment plan.",
      cta: { label: "Start free trial", href: trial, app: true },
    },
    {
      id: "ai-governance",
      name: "AI Governance",
      badges: ["Available now", "Platform Professional"],
      problem:
        "AI is being adopted faster than it's being governed, and regulators (EU AI Act, ISO 42001) now expect a defensible inventory and assessment trail.",
      inputs: [
        "AI system inventory",
        "Model and use-case metadata",
        "Internal AI policies and frameworks",
      ],
      automation: [
        "Classify model risk",
        "Assess against ISO 42001 and the EU AI Act",
        "Track policy compliance and approvals",
      ],
      outputs: [
        "Governed AI system register",
        "Assessment and risk classification",
        "Audit-ready governance evidence",
      ],
      deliverables: ["AI system inventory", "Governance assessments", "EU AI Act / ISO 42001 mapping"],
      outcome:
        "A defensible, current record of every AI system and how it's governed — ready for auditors and boards.",
      cta: { label: "Start free trial", href: trial, app: true },
    },
    {
      id: "compliance",
      name: "Compliance",
      badges: ["Available now", "Platform Professional"],
      problem:
        "Compliance lives in disconnected spreadsheets and screenshots, so audits become fire drills and gaps surface far too late.",
      inputs: [
        "Framework selection (SOC 2, ISO 27001, NIST CSF…)",
        "Controls and evidence",
        "Signals affecting control status",
      ],
      automation: [
        "Map controls across frameworks",
        "Detect gaps and overlaps",
        "Track evidence freshness continuously",
      ],
      outputs: [
        "Control and framework registry",
        "Gap analysis",
        "Audit-ready reports",
      ],
      deliverables: ["Framework registry", "Control mapping & gap analysis", "Evidence tracking"],
      outcome: "Continuous, audit-ready compliance — not a once-a-year scramble.",
      cta: { label: "Start free trial", href: trial, app: true },
    },
    {
      id: "executive-reporting",
      name: "Executive Reporting",
      badges: ["Available now", "Platform Professional"],
      problem:
        "Boards ask “are we secure?” and security leaders struggle to answer in business terms backed by current, defensible data.",
      inputs: [
        "Posture scores across all domains",
        "Top risks and open actions",
        "Vendor, AI and compliance status",
      ],
      automation: [
        "Roll domain posture into one score",
        "Surface the risks that moved this period",
        "Generate a leadership-ready narrative",
      ],
      outputs: [
        "Executive posture dashboard",
        "Board-ready risk summary",
        "Prioritized action plan",
      ],
      deliverables: ["Leadership dashboard", "Posture scoring across 4 domains", "Exportable reporting"],
      outcome:
        "Walk into the board meeting with a clear, current, defensible picture of risk — and what's being done about it.",
      cta: { label: "See pricing & plans", href: "/pricing/" },
    },
  ];
}

export default function PlatformPage() {
  const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.securelogicai.com";
  // Founding pricing sourced from the shared model — no hard-coded figures.
  const platformPro = getPricingTiers(APP_URL).find((t) => t.id === "platform-professional")!;
  const modules = getPlatformModules(APP_URL);

  return (
    <>
      {/* Header */}
      <section className="relative overflow-hidden bg-bg text-text pt-20 pb-24 px-4">
        <div
          className="absolute inset-0 pointer-events-none"
          aria-hidden="true"
          style={{ background: "radial-gradient(ellipse 60% 80% at 50% 120%, rgba(0,196,180,0.15) 0%, transparent 65%)" }}
        />
        <div className="relative max-w-3xl mx-auto text-center">
          <span className="inline-block text-xs font-bold text-accent uppercase tracking-widest mb-4">
            Platform Overview
          </span>
          <h1 className="text-5xl sm:text-6xl font-extrabold leading-tight tracking-tight mb-6">
            One platform for<br />total risk coverage
          </h1>
          <p className="text-lg text-text-body leading-relaxed max-w-2xl mx-auto">
            SecureLogic AI brings vendor risk, AI governance, compliance, threat intelligence, and
            executive reporting into a single analytical platform — powered by the SecureLogic Engine.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
            <a href={`${APP_URL}/signup?plan=platform_annual`} className="btn-primary">
              Start Free Trial
            </a>
            <Link href="/contact/" className="btn-outline">Book a Demo</Link>
          </div>
        </div>
      </section>

      {/* Engine layer */}
      <section className="py-16 px-4 bg-bg-elevated border-b border-hairline">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-xl font-bold text-text mb-3">Powered by the SecureLogic Engine</h2>
          <p className="text-text-muted max-w-2xl mx-auto text-sm leading-relaxed">
            Every module is built on top of the same analytical core — a risk scoring and insight
            generation engine that transforms raw signals into explainable, repeatable, actionable
            intelligence. No isolated tools. No duplicated logic.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3 text-xs font-medium">
            {["Risk scoring engine", "Signal ingestion", "Insight generation", "Entitlement system", "API layer", "Audit logging"].map((f) => (
              <span key={f} className="px-3 py-1.5 bg-bg-elevated border border-hairline rounded-full text-text-body shadow-sm">
                {f}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Modules */}
      <section className="py-20 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="max-w-2xl mb-12">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-text leading-tight mb-4">
              Five modules. One connected risk model.
            </h2>
            <p className="text-text-muted leading-relaxed">
              Every module reads from and writes to the same shared entities — so vendors, AI
              systems, controls, signals, risks, and actions stay connected end to end.
            </p>
            <div className="mt-6 flex flex-wrap gap-2.5">
              {modules.map((m) => (
                <a
                  key={m.id}
                  href={`#${m.id}`}
                  className="px-3 py-1.5 rounded-full border border-hairline bg-bg-elevated text-sm text-text-body hover:border-accent hover:text-text transition-colors"
                >
                  {m.name}
                </a>
              ))}
            </div>
          </div>

          <div className="space-y-12">
            {modules.map((m, i) => (
              <div key={m.id} id={m.id} className="scroll-mt-24">
                {i > 0 && <div className="border-t border-hairline mb-12" />}

                {/* Header: badges, name, problem */}
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  {m.badges.map((b, bi) => (
                    <span
                      key={b}
                      className={
                        bi === 0
                          ? "text-xs font-semibold px-2.5 py-1 rounded-full bg-accent/10 text-accent border border-accent/30"
                          : "text-xs font-medium px-2.5 py-1 rounded-full bg-bg-elevated-2 text-text-muted"
                      }
                    >
                      {b}
                    </span>
                  ))}
                </div>
                <h3 className="text-2xl sm:text-3xl font-bold text-text mb-3">{m.name}</h3>
                <p className="text-text-muted leading-relaxed max-w-3xl mb-8">{m.problem}</p>

                {/* Workflow: Inputs → Automation → Outputs */}
                <div className="grid md:grid-cols-3 gap-5 mb-6">
                  {([
                    ["Inputs", m.inputs],
                    ["Automation", m.automation],
                    ["Outputs", m.outputs],
                  ] as const).map(([label, items]) => (
                    <div key={label} className="card p-6">
                      <p className="pill-mono text-accent mb-4">{label}</p>
                      <ul className="space-y-2.5">
                        {items.map((it) => (
                          <li key={it} className="flex items-start gap-2.5 text-sm text-text-body leading-relaxed">
                            <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-accent/70 flex-shrink-0" />
                            {it}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>

                {/* Deliverables */}
                <div className="flex flex-wrap items-center gap-2 mb-5">
                  <span className="pill-mono text-text-muted mr-1">What you get</span>
                  {m.deliverables.map((d) => (
                    <span
                      key={d}
                      className="px-2.5 py-1 rounded-full border border-hairline bg-bg-elevated text-xs text-text-body"
                    >
                      {d}
                    </span>
                  ))}
                </div>

                {/* Business outcome */}
                <div className="rounded-xl border border-accent/25 bg-accent/5 px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-3 mb-5">
                  <span className="pill-mono text-accent flex-shrink-0">Business outcome</span>
                  <p className="text-sm text-text-body leading-relaxed">{m.outcome}</p>
                </div>

                {m.cta.app ? (
                  <a
                    href={m.cta.href}
                    className="inline-flex items-center text-sm font-semibold text-accent hover:text-accent-hover transition-colors"
                  >
                    {m.cta.label} →
                  </a>
                ) : (
                  <Link
                    href={m.cta.href}
                    className="inline-flex items-center text-sm font-semibold text-accent hover:text-accent-hover transition-colors"
                  >
                    {m.cta.label} →
                  </Link>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Plans CTA */}
      <section className="bg-bg py-16 px-4 text-text text-center">
        <div className="max-w-xl mx-auto">
          <p className="text-xs font-bold text-accent uppercase tracking-widest mb-3">
            Platform Professional
          </p>
          <h2 className="text-2xl font-bold mb-3">The full risk platform</h2>
          <p className="text-accent text-sm font-semibold mb-4">{platformPro.urgency}</p>

          <div className="flex items-baseline justify-center gap-1.5">
            <span className="text-4xl font-bold">{platformPro.price}</span>
            <span className="text-sm text-text-muted">{platformPro.priceNote}</span>
          </div>
          <p className="text-sm text-text-muted mt-1">{platformPro.priceDetails?.join(" · ")}</p>
          <p className="text-xs text-text-muted mt-2">{platformPro.lockNote}</p>
          <p className="text-xs text-accent/90 font-medium mt-3 mb-7">{platformPro.allowance}</p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <a
              href={`${APP_URL}/signup?plan=platform_annual`}
              className="inline-flex items-center justify-center px-7 py-3 rounded-lg bg-accent text-[#04201d] font-semibold hover:bg-accent-hover transition-colors text-sm"
            >
              Start Free Trial
            </a>
            <Link
              href="/contact/"
              className="inline-flex items-center justify-center px-7 py-3 rounded-lg border border-hairline text-text font-semibold hover:border-accent hover:text-white transition-colors text-sm"
            >
              Talk to Sales
            </Link>
          </div>

          <p className="mt-6 text-xs text-text-muted">
            Need more than 10 seats or 50 entities, SSO/SAML, or white-labeling? That&apos;s
            Enterprise.{" "}
            <Link href="/pricing/" className="text-accent hover:underline">
              See full pricing and plans →
            </Link>
          </p>
        </div>
      </section>
    </>
  );
}
