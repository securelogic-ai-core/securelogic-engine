import type { Metadata } from "next";
import Link from "next/link";
import { getPricingTiers } from "@/lib/pricing";

export const metadata: Metadata = {
  title: "Platform",
  description:
    "The SecureLogic AI platform — Vendor Risk, AI Governance, Compliance, and Intelligence modules for unified risk coverage.",
};

export default function PlatformPage() {
  const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.securelogicai.com";
  // Founding pricing sourced from the shared model — no hard-coded figures.
  const platformPro = getPricingTiers(APP_URL).find((t) => t.id === "platform-professional")!;

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
            SecureLogic AI brings vendor risk, AI governance, compliance, and threat intelligence
            into a single analytical platform — powered by the SecureLogic Engine.
          </p>
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
        <div className="max-w-5xl mx-auto space-y-12">
          {/* Intelligence — Available */}
          <div id="intelligence" className="grid md:grid-cols-2 gap-10 items-center">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-accent/10 text-accent border border-accent/30">
                  Available now
                </span>
              </div>
              <h2 className="text-2xl font-bold text-text mb-4">Intelligence</h2>
              <p className="text-text-muted leading-relaxed mb-5">
                Continuous external signal monitoring across security, regulatory, vendor risk, and
                AI governance sources — synthesized into the weekly Intelligence Brief.
              </p>
              <ul className="space-y-2 text-sm text-text-body mb-6">
                {[
                  "Weekly Intelligence Brief delivery",
                  "Risk-scored signals by category",
                  "Executive synthesis and recommendations",
                  "Vendor risk, security, regulatory, and AI feeds",
                ].map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href="/intelligence-brief/"
                className="inline-flex items-center px-5 py-2.5 rounded-lg bg-accent text-[#04201d] text-sm font-semibold hover:bg-accent-hover transition-colors"
              >
                Learn more about the Intelligence Brief
              </Link>
            </div>
            <div className="bg-bg rounded-xl p-6 text-text">
              <p className="text-xs text-accent font-semibold uppercase tracking-wider mb-3">
                Intelligence Brief
              </p>
              <div className="flex gap-2 mb-5">
                <span className="px-2.5 py-1 bg-danger/15 text-danger text-xs font-semibold rounded-full border border-danger/30">3 Critical</span>
                <span className="px-2.5 py-1 bg-warning/15 text-warning text-xs font-semibold rounded-full border border-warning/30">7 High</span>
              </div>
              <div className="space-y-2">
                {["Security advisory — CVE-2026-XXXX", "Regulatory — EU AI Act update", "Vendor risk — Supply chain incident"].map((s) => (
                  <div key={s} className="text-xs text-text-muted bg-bg-elevated rounded-lg px-3 py-2">{s}</div>
                ))}
              </div>
            </div>
          </div>

          <div className="border-t border-hairline" />

          {/* Vendor Risk */}
          <div id="vendor-risk" className="grid md:grid-cols-2 gap-10 items-center">
            <div className="md:order-2">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-accent/10 text-accent border border-accent/30">
                  Available now
                </span>
                <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-bg-elevated-2 text-text-muted">
                  Platform Professional
                </span>
              </div>
              <h2 className="text-2xl font-bold text-text mb-4">Vendor Risk</h2>
              <p className="text-text-muted leading-relaxed mb-5">
                Enter and assess your third-party vendors, ingest their assurance documents
                (SOC 2, ISO 27001), score risk, and map findings to your risk register — so you
                can see where vendors fall short.
              </p>
              <ul className="space-y-2 text-sm text-text-body">
                {[
                  "Vendor inventory and onboarding",
                  "Risk scoring and trending",
                  "Assessment intake and findings",
                  "Document ingestion (SOC 2, ISO 27001)",
                  "Vendor findings mapped to your risk register",
                ].map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-text-muted/50 flex-shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
            <div className="md:order-1 bg-bg-elevated rounded-xl border border-hairline p-8 text-center">
              <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center mx-auto mb-4 text-accent">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
              </div>
              <p className="text-sm font-medium text-text-body mb-2">Vendor Risk module</p>
              <p className="text-xs text-text-muted mb-4">Included in Platform Professional.</p>
              <a href={`${APP_URL}/signup?plan=platform_annual`} className="text-xs font-semibold text-accent hover:text-accent-hover transition-colors">
                Start Free Trial →
              </a>
            </div>
          </div>

          <div className="border-t border-hairline" />

          {/* AI Governance */}
          <div id="ai-governance" className="grid md:grid-cols-2 gap-10 items-center">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-accent/10 text-accent border border-accent/30">
                  Available now
                </span>
                <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-bg-elevated-2 text-text-muted">
                  Platform Professional
                </span>
              </div>
              <h2 className="text-2xl font-bold text-text mb-4">AI Governance</h2>
              <p className="text-text-muted leading-relaxed mb-5">
                Inventory, assess, and govern AI systems across your organization against ISO 42001,
                EU AI Act, and internal policy frameworks.
              </p>
              <ul className="space-y-2 text-sm text-text-body">
                {[
                  "AI system inventory",
                  "Governance assessment framework",
                  "ISO 42001 and EU AI Act mapping",
                  "Model risk classification",
                  "Policy compliance tracking",
                ].map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-text-muted/50 flex-shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-bg-elevated rounded-xl border border-hairline p-8 text-center">
              <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center mx-auto mb-4 text-accent">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 3H7a2 2 0 00-2 2v2m4-4h6m-6 0V1m6 2h2a2 2 0 012 2v2m0 0V9m0-2h2M21 9v6m0 0v2a2 2 0 01-2 2h-2m0 0H9m6 0v2m-6-2H7a2 2 0 01-2-2v-2m0 0V9m0 6H3M3 9V7a2 2 0 012-2h2m2 4h6v6H9V9z" />
                </svg>
              </div>
              <p className="text-sm font-medium text-text-body mb-2">AI Governance module</p>
              <p className="text-xs text-text-muted mb-4">Included in Platform Professional.</p>
              <a href={`${APP_URL}/signup?plan=platform_annual`} className="text-xs font-semibold text-accent hover:text-accent-hover transition-colors">
                Start Free Trial →
              </a>
            </div>
          </div>

          <div className="border-t border-hairline" />

          {/* Compliance */}
          <div id="compliance" className="grid md:grid-cols-2 gap-10 items-center">
            <div className="md:order-2">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-accent/10 text-accent border border-accent/30">
                  Available now
                </span>
                <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-bg-elevated-2 text-text-muted">
                  Platform Professional
                </span>
              </div>
              <h2 className="text-2xl font-bold text-text mb-4">Compliance</h2>
              <p className="text-text-muted leading-relaxed mb-5">
                Map controls to SOC 2, NIST CSF, ISO 27001, and more. Track gaps, manage evidence,
                and produce audit-ready reports continuously.
              </p>
              <ul className="space-y-2 text-sm text-text-body">
                {[
                  "Framework registry (SOC 2, NIST, ISO)",
                  "Control mapping and gap analysis",
                  "Evidence tracking",
                  "Continuous compliance monitoring",
                  "Audit-ready reporting",
                ].map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-text-muted/50 flex-shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
            <div className="md:order-1 bg-bg-elevated rounded-xl border border-hairline p-8 text-center">
              <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center mx-auto mb-4 text-accent">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <p className="text-sm font-medium text-text-body mb-2">Compliance module</p>
              <p className="text-xs text-text-muted mb-4">Included in Platform Professional.</p>
              <a href={`${APP_URL}/signup?plan=platform_annual`} className="text-xs font-semibold text-accent hover:text-accent-hover transition-colors">
                Start Free Trial →
              </a>
            </div>
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
