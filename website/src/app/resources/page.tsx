import type { Metadata } from "next";
import Link from "next/link";
import { SECURITY_OVERVIEW_PDF } from "@/lib/nav";

export const metadata: Metadata = {
  title: "Resources",
  description:
    "Resources from SecureLogic AI — the weekly Intelligence Brief, security documentation, and material to help security and GRC teams turn signals into action.",
  openGraph: {
    title: "Resources — SecureLogic AI",
    description:
      "The weekly Intelligence Brief, security documentation, and material for security and GRC teams.",
  },
};

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.securelogicai.com";

type ResourceStatus = "available" | "in-development";

interface Resource {
  category: string;
  title: string;
  description: string;
  audience: string;
  outcome: string;
  status: ResourceStatus;
  cta: { label: string; href: string; external?: boolean };
}

// Honesty constraint: items that don't exist yet are marked "In development" and
// link to the Brief signup ("Get notified") — never to a fabricated download.
const NOTIFY = { label: "Get notified", href: "/#brief-signup" };

const RESOURCES: Resource[] = [
  // ── Executive Briefings ──────────────────────────────────────────────
  {
    category: "Executive Briefings",
    title: "The weekly Intelligence Brief",
    description:
      "Executive-grade risk intelligence — vulnerabilities, vendor risk, regulatory change, and AI governance, synthesized and prioritized every week.",
    audience: "CISOs, security & GRC leaders",
    outcome: "A prioritized view of the risk signals that touch your organization.",
    status: "available",
    cta: { label: "Get the Free Brief", href: "/#brief-signup" },
  },
  {
    category: "Executive Briefings",
    title: "Sample brief issue",
    description:
      "See the exact structure and format of a real issue — signal snapshot, why-it-matters, and recommended actions.",
    audience: "Anyone evaluating the Brief",
    outcome: "Know what lands in your inbox before you subscribe.",
    status: "available",
    cta: { label: "See a sample", href: "/intelligence-brief/" },
  },
  // ── Security Guides ──────────────────────────────────────────────────
  {
    category: "Security Guides",
    title: "SecureLogic AI Security Overview",
    description:
      "Our full security program, architecture, controls, and maturity roadmap in a single document — built for vendor due diligence.",
    audience: "Procurement, security reviewers",
    outcome: "Complete a vendor security review faster.",
    status: "available",
    cta: { label: "Download the PDF", href: SECURITY_OVERVIEW_PDF, external: true },
  },
  {
    category: "Security Guides",
    title: "How the platform works",
    description:
      "See how external signals become vendors, AI systems, controls, obligations, risks, findings, and posture across one connected operating picture.",
    audience: "Security & GRC practitioners",
    outcome: "Understand the SecureLogic operating model end to end.",
    status: "available",
    cta: { label: "Explore the Platform", href: "/platform/" },
  },
  // ── AI Governance ────────────────────────────────────────────────────
  {
    category: "AI Governance",
    title: "AI Governance Starter Guide",
    description:
      "A practical walkthrough for standing up an AI system inventory and governance program aligned to ISO 42001 and the EU AI Act.",
    audience: "CISOs, AI & data leaders",
    outcome: "A defensible plan to inventory and govern AI systems.",
    status: "in-development",
    cta: NOTIFY,
  },
  {
    category: "AI Governance",
    title: "NIST AI RMF ↔ EU AI Act crosswalk",
    description:
      "A side-by-side mapping of NIST AI RMF functions to EU AI Act obligations, so you can plan once and satisfy both.",
    audience: "Compliance & AI governance teams",
    outcome: "One control set mapped to two frameworks.",
    status: "in-development",
    cta: NOTIFY,
  },
  // ── Vendor Risk ──────────────────────────────────────────────────────
  {
    category: "Vendor Risk",
    title: "Third-Party Risk Management Guide",
    description:
      "How to build a repeatable vendor assessment process — from intake and assurance review to scoring and ongoing monitoring.",
    audience: "TPRM, procurement, security",
    outcome: "A consistent, defensible vendor assessment workflow.",
    status: "in-development",
    cta: NOTIFY,
  },
  {
    category: "Vendor Risk",
    title: "Vendor Assessment Template",
    description:
      "A starter assessment template covering security, privacy, AI use, and concentration risk for new and existing vendors.",
    audience: "TPRM analysts",
    outcome: "Assess a new vendor without starting from a blank page.",
    status: "in-development",
    cta: NOTIFY,
  },
  // ── Checklists ───────────────────────────────────────────────────────
  {
    category: "Checklists",
    title: "Board Reporting Checklist",
    description:
      "The elements of a credible, board-ready security and risk update — and how to keep it current.",
    audience: "CISOs reporting to leadership",
    outcome: "Walk into the board meeting prepared.",
    status: "in-development",
    cta: NOTIFY,
  },
  {
    category: "Checklists",
    title: "AI Governance Readiness Checklist",
    description:
      "A quick self-assessment of where your AI governance program stands against emerging regulatory expectations.",
    audience: "AI governance owners",
    outcome: "Find your gaps before an auditor does.",
    status: "in-development",
    cta: NOTIFY,
  },
  // ── Templates ────────────────────────────────────────────────────────
  {
    category: "Templates",
    title: "Risk Register Template",
    description:
      "A structured risk register with severity, treatment, and ownership fields aligned to the SecureLogic risk model.",
    audience: "Risk & GRC teams",
    outcome: "Track and treat risk in a consistent structure.",
    status: "in-development",
    cta: NOTIFY,
  },
  // ── Policy Samples ───────────────────────────────────────────────────
  {
    category: "Policy Samples",
    title: "AI Acceptable Use Policy (sample)",
    description:
      "A starting-point policy for responsible internal AI use, covering data handling, approved tools, and human oversight.",
    audience: "Security, legal, HR",
    outcome: "Stand up an AI use policy in days, not weeks.",
    status: "in-development",
    cta: NOTIFY,
  },
  // ── White Papers ─────────────────────────────────────────────────────
  {
    category: "White Papers",
    title: "From signals to posture: the connected risk model",
    description:
      "How disconnected risk signals become a single, explainable operating picture across cyber, vendor, AI, and compliance.",
    audience: "Security & GRC leaders",
    outcome: "A reference model for unified risk operations.",
    status: "in-development",
    cta: NOTIFY,
  },
  // ── Industry Insights ────────────────────────────────────────────────
  {
    category: "Industry Insights",
    title: "The State of AI Governance",
    description:
      "Trends and regulatory shifts shaping how organizations inventory, assess, and govern AI — drawn from our intelligence pipeline.",
    audience: "Executives & boards",
    outcome: "Brief leadership on where AI governance is heading.",
    status: "in-development",
    cta: NOTIFY,
  },
];

// Category display order for the knowledge-center grid.
const RESOURCE_CATEGORIES = [
  "Executive Briefings",
  "Security Guides",
  "AI Governance",
  "Vendor Risk",
  "Checklists",
  "Templates",
  "Policy Samples",
  "White Papers",
  "Industry Insights",
];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export default function ResourcesPage() {
  return (
    <>
      {/* Hero */}
      <section className="bg-bg text-text border-b border-hairline">
        <div className="container-site py-20 lg:py-24">
          <div className="max-w-3xl">
            <p className="eyebrow mb-4">Resources</p>
            <h1 className="text-[2.5rem] sm:text-5xl font-extrabold leading-[1.07] tracking-tight mb-6">
              Material for teams that turn signals into action.
            </h1>
            <p className="text-lg text-text-body leading-relaxed">
              The weekly Intelligence Brief, security documentation, and resources to help security
              and GRC leaders understand exposure and decide what to do next.
            </p>
          </div>
        </div>
      </section>

      {/* Knowledge center */}
      <section className="bg-bg">
        <div className="container-site py-16 lg:py-20">
          {/* Category quick-nav */}
          <div className="mb-12 flex flex-wrap gap-2.5" aria-label="Resource categories">
            {RESOURCE_CATEGORIES.map((c) => (
              <a
                key={c}
                href={`#${slug(c)}`}
                className="px-3 py-1.5 rounded-full border border-hairline bg-bg-elevated text-sm text-text-body hover:border-accent hover:text-text transition-colors"
              >
                {c}
              </a>
            ))}
          </div>

          <div className="space-y-14">
            {RESOURCE_CATEGORIES.map((cat) => {
              const items = RESOURCES.filter((r) => r.category === cat);
              if (items.length === 0) return null;
              return (
                <div key={cat} id={slug(cat)} className="scroll-mt-24">
                  <h2 className="text-xl font-bold text-text mb-5">{cat}</h2>
                  <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
                    {items.map((r) => (
                      <div key={r.title} className="card p-7 flex flex-col">
                        <div className="mb-3">
                          {r.status === "available" ? (
                            <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-accent/10 text-accent border border-accent/30">
                              Available
                            </span>
                          ) : (
                            <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-bg-elevated-2 text-text-muted">
                              In development
                            </span>
                          )}
                        </div>
                        <h3 className="text-text font-bold text-lg mb-2 leading-snug">{r.title}</h3>
                        <p className="text-sm text-text-muted leading-relaxed mb-5">{r.description}</p>
                        <p className="text-xs leading-relaxed mb-1">
                          <span className="pill-mono text-text-muted">Audience</span>{" "}
                          <span className="text-text-body">{r.audience}</span>
                        </p>
                        <p className="text-xs leading-relaxed mb-6">
                          <span className="pill-mono text-text-muted">Outcome</span>{" "}
                          <span className="text-text-body">{r.outcome}</span>
                        </p>
                        <div className="mt-auto">
                          {r.cta.external ? (
                            <a
                              href={r.cta.href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-sm font-semibold text-accent hover:text-accent-hover transition-colors"
                            >
                              {r.cta.label} →
                            </a>
                          ) : (
                            <Link
                              href={r.cta.href}
                              className="text-sm font-semibold text-accent hover:text-accent-hover transition-colors"
                            >
                              {r.cta.label} →
                            </Link>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-bg-elevated border-t border-hairline">
        <div className="container-site py-16 text-center">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-text mb-6">
            Start with the brief. Stay for the platform.
          </h2>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/#brief-signup" className="btn-primary">Get the Free Brief</Link>
            <a href={`${APP_URL}/signup?plan=platform_annual`} className="btn-outline">Start Free Trial</a>
          </div>
        </div>
      </section>
    </>
  );
}
