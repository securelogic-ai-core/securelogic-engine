import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Unified Risk Intelligence Platform",
  description:
    "SecureLogic AI helps organizations see, understand, and act on their total risk exposure across vendors, controls, compliance frameworks, and AI systems.",
};

// ─── Module icons ─────────────────────────────────────────────────────────────

function IconVendorRisk() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
    </svg>
  );
}

function IconAIGovernance() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M9 3H7a2 2 0 00-2 2v2m4-4h6m-6 0V1m6 2h2a2 2 0 012 2v2m0 0V9m0-2h2M21 9v6m0 0v2a2 2 0 01-2 2h-2m0 0H9m6 0v2m-6-2H7a2 2 0 01-2-2v-2m0 0V9m0 6H3M3 9V7a2 2 0 012-2h2m2 4h6v6H9V9z" />
    </svg>
  );
}

function IconCompliance() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  );
}

function IconIntelligence() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
    </svg>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HomePage() {
  return (
    <>
      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="relative bg-navy-900 text-white overflow-hidden">
        {/* Dot-grid texture */}
        <div
          className="absolute inset-0 opacity-[0.055]"
          style={{
            backgroundImage: "radial-gradient(circle, #2dd4bf 1px, transparent 1px)",
            backgroundSize: "28px 28px",
          }}
        />
        {/* Bottom fade */}
        <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-navy-900 to-transparent" />

        <div className="relative max-w-4xl mx-auto text-center px-4 pt-24 pb-28">
          {/* Eyebrow */}
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-teal-600/20 border border-teal-500/30 text-teal-300 text-xs font-medium mb-8 tracking-wide">
            <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse flex-shrink-0" />
            Intelligence Brief — Live weekly delivery
          </div>

          {/* Headline */}
          <h1 className="text-5xl sm:text-6xl font-bold leading-[1.08] tracking-tight mb-6">
            Total risk exposure.
            <br />
            <span className="text-teal-400">One analytical engine.</span>
          </h1>

          {/* Subtitle */}
          <p className="text-lg text-slate-300 leading-relaxed max-w-2xl mx-auto mb-10">
            SecureLogic AI continuously monitors vendors, compliance frameworks, AI systems,
            and external threats — scoring every signal and delivering decision-ready
            intelligence to your team.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-14">
            <a
              href="https://app.securelogicai.com/register"
              className="inline-flex items-center justify-center px-7 py-3.5 rounded-lg bg-teal-600 text-white font-semibold hover:bg-teal-500 transition-colors text-sm"
            >
              Get started free
            </a>
            <Link
              href="/intelligence-brief/"
              className="inline-flex items-center justify-center gap-1.5 px-7 py-3.5 rounded-lg border border-slate-600 text-slate-200 font-semibold hover:border-teal-500/60 hover:text-white transition-colors text-sm"
            >
              Explore the Intelligence Brief
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>

          {/* Stat strip */}
          <div className="flex flex-wrap justify-center gap-x-8 gap-y-2">
            {[
              "22+ monitored signal sources",
              "4 risk domains",
              "Risk-scored weekly",
              "Enterprise-grade output",
            ].map((stat) => (
              <span key={stat} className="flex items-center gap-2 text-xs text-slate-500 font-medium">
                <span className="w-1 h-1 rounded-full bg-teal-700 flex-shrink-0" />
                {stat}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── Domain bar ────────────────────────────────────────────────────── */}
      <section className="bg-white border-b border-slate-200 py-5 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="flex flex-wrap justify-center gap-x-10 gap-y-3">
            {[
              { label: "Vendor Risk", sub: "Third-party exposure" },
              { label: "AI Governance", sub: "ISO 42001 alignment" },
              { label: "Compliance", sub: "SOC 2 · NIST · ISO 27001" },
              { label: "Threat Intelligence", sub: "Security & regulatory signals" },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-2.5 text-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-teal-500 flex-shrink-0" />
                <span className="font-semibold text-slate-800">{item.label}</span>
                <span className="text-slate-400 hidden sm:inline">{item.sub}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Intelligence Brief spotlight ──────────────────────────────────── */}
      <section className="py-20 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <span className="inline-block text-xs font-semibold text-teal-600 uppercase tracking-wider mb-3">
                Available now
              </span>
              <h2 className="text-3xl font-bold text-slate-900 mb-5 leading-tight">
                The SecureLogic AI Intelligence Brief
              </h2>
              <p className="text-slate-600 leading-relaxed mb-6">
                A weekly executive-grade risk intelligence briefing, built from hundreds of signals
                across security advisories, regulatory updates, vendor risk events, and AI governance
                developments — synthesized into decision-ready intelligence.
              </p>
              <ul className="space-y-3 mb-8">
                {[
                  "Curated from security, regulatory, and AI risk sources",
                  "Risk-scored and prioritized by impact",
                  "Actionable recommendations per finding",
                  "Executive summary built for leadership distribution",
                  "Delivered weekly to your inbox",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-3 text-sm text-slate-700">
                    <span className="mt-0.5 w-5 h-5 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center flex-shrink-0">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
              <div className="flex gap-4">
                <Link
                  href="/intelligence-brief/"
                  className="inline-flex items-center px-5 py-2.5 rounded-lg bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 transition-colors"
                >
                  Learn more
                </Link>
                <a
                  href="https://app.securelogicai.com/register"
                  className="inline-flex items-center px-5 py-2.5 rounded-lg border border-slate-300 text-slate-700 text-sm font-semibold hover:border-slate-400 transition-colors"
                >
                  Subscribe — $39/mo
                </a>
              </div>
            </div>

            {/* Brief preview card */}
            <div className="bg-slate-900 rounded-xl p-6 text-white shadow-xl">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-xs text-teal-400 font-medium uppercase tracking-wider">SecureLogic AI</p>
                  <p className="text-sm font-semibold mt-0.5">Intelligence Brief #12</p>
                </div>
                <span className="text-xs text-slate-400">Weekly</span>
              </div>
              <div className="h-px bg-slate-700 mb-5" />
              <p className="text-xs text-slate-400 uppercase tracking-wider font-medium mb-3">Risk Snapshot</p>
              <div className="flex gap-2 mb-5">
                <span className="px-2.5 py-1 bg-red-900/50 text-red-300 text-xs font-semibold rounded-full border border-red-800/40">3 Critical</span>
                <span className="px-2.5 py-1 bg-orange-900/50 text-orange-300 text-xs font-semibold rounded-full border border-orange-800/40">7 High</span>
                <span className="px-2.5 py-1 bg-yellow-900/40 text-yellow-300 text-xs font-semibold rounded-full border border-yellow-800/40">12 Medium</span>
              </div>
              <div className="space-y-3">
                {[
                  { tag: "VENDOR RISK", title: "Critical patch issued for widely-deployed network appliance" },
                  { tag: "REGULATORY", title: "EU AI Act enforcement timeline confirmed for high-risk systems" },
                  { tag: "SECURITY", title: "Zero-day affecting enterprise VPN solutions under active exploitation" },
                ].map((item) => (
                  <div key={item.title} className="flex items-start gap-3 p-3 bg-slate-800/60 rounded-lg">
                    <span className="mt-0.5 text-[10px] font-bold text-teal-400 bg-teal-900/40 px-2 py-0.5 rounded uppercase tracking-wide whitespace-nowrap">
                      {item.tag}
                    </span>
                    <p className="text-xs text-slate-300 leading-snug">{item.title}</p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-slate-500 mt-4 text-center">
                + 14 more signals this issue — subscribers only
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Platform overview ─────────────────────────────────────────────── */}
      <section className="bg-slate-50 border-y border-slate-200 py-20 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <span className="inline-block text-xs font-semibold text-teal-600 uppercase tracking-wider mb-3">
              Platform
            </span>
            <h2 className="text-3xl font-bold text-slate-900 mb-4">
              One platform. Total risk coverage.
            </h2>
            <p className="text-slate-500 max-w-2xl mx-auto leading-relaxed">
              SecureLogic AI unifies the risk domains that matter most to modern enterprises — so
              you stop chasing gaps across disconnected tools.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              {
                title: "Vendor Risk",
                description: "Continuous monitoring, scoring, and assessment of your third-party vendor ecosystem.",
                Icon: IconVendorRisk,
                status: "Coming soon",
                available: false,
              },
              {
                title: "AI Governance",
                description: "Inventory, assess, and govern AI systems across ISO 42001 and internal policy frameworks.",
                Icon: IconAIGovernance,
                status: "Coming soon",
                available: false,
              },
              {
                title: "Compliance",
                description: "Map controls to SOC 2, NIST, ISO 27001, and more. Track gaps and evidence continuously.",
                Icon: IconCompliance,
                status: "Coming soon",
                available: false,
              },
              {
                title: "Intelligence",
                description: "External risk signal monitoring — regulatory, security, vendor, and AI developments.",
                Icon: IconIntelligence,
                status: "Available now",
                available: true,
              },
            ].map((module) => (
              <div key={module.title} className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm">
                <div
                  className={`w-9 h-9 rounded-lg flex items-center justify-center mb-4 ${
                    module.available
                      ? "bg-teal-50 text-teal-600"
                      : "bg-slate-100 text-slate-400"
                  }`}
                >
                  <module.Icon />
                </div>
                <h3 className="font-semibold text-slate-900 mb-2">{module.title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed mb-4">{module.description}</p>
                <span
                  className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                    module.available
                      ? "bg-teal-50 text-teal-700 border border-teal-200"
                      : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {module.status}
                </span>
              </div>
            ))}
          </div>

          <div className="text-center mt-10">
            <Link
              href="/platform/"
              className="inline-flex items-center text-sm font-medium text-teal-600 hover:text-teal-700"
            >
              Explore the platform roadmap
              <svg className="ml-1.5 w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>
      </section>

      {/* ── How it works ──────────────────────────────────────────────────── */}
      <section className="py-20 px-4 bg-white">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl font-bold text-slate-900 mb-4">How SecureLogic AI works</h2>
            <p className="text-slate-500 max-w-xl mx-auto leading-relaxed">
              The SecureLogic Engine is the analytical core — transforming raw signals into
              explainable, repeatable, actionable risk intelligence.
            </p>
          </div>

          <div className="relative grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10 lg:gap-6">
            {/* Connecting line — desktop only */}
            <div className="hidden lg:block absolute top-5 left-[12.5%] right-[12.5%] h-px bg-slate-200" />

            {[
              {
                step: "01",
                title: "Signal ingestion",
                description:
                  "Hundreds of sources continuously monitored — security advisories, regulatory filings, vendor disclosures, AI policy updates.",
              },
              {
                step: "02",
                title: "Risk scoring",
                description:
                  "Every signal scored by impact, novelty, relevance, and urgency using the SecureLogic Engine's analytical layer.",
              },
              {
                step: "03",
                title: "Insight generation",
                description:
                  "Scored signals synthesized into structured insights — prioritized findings with recommended actions.",
              },
              {
                step: "04",
                title: "Intelligence delivery",
                description:
                  "Decision-ready intelligence surfaced in the platform dashboard and delivered via the Intelligence Brief.",
              },
            ].map((item) => (
              <div key={item.step} className="relative flex flex-col items-center text-center lg:items-center">
                <div className="relative z-10 w-10 h-10 rounded-full bg-teal-600 text-white text-sm font-bold flex items-center justify-center mb-5 ring-4 ring-white flex-shrink-0">
                  {item.step}
                </div>
                <h3 className="font-semibold text-slate-900 mb-2">{item.title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing strip ─────────────────────────────────────────────────── */}
      <section className="bg-slate-900 py-20 px-4 text-white">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-4">Start with intelligence. Scale to the platform.</h2>
          <p className="text-slate-400 mb-10 leading-relaxed">
            Access the Intelligence Brief today. Full platform access available as modules launch.
          </p>

          <div className="grid sm:grid-cols-3 gap-6 max-w-3xl mx-auto mb-10">
            {[
              {
                name: "Free",
                price: "$0",
                description: "Brief preview, signal headlines",
                cta: "Get started",
                href: "https://app.securelogicai.com/register",
                featured: false,
              },
              {
                name: "Professional",
                price: "$39/mo",
                description: "Full Intelligence Brief access, all signals, recommendations",
                cta: "Subscribe",
                href: "https://app.securelogicai.com/register?plan=professional",
                featured: true,
              },
              {
                name: "Enterprise",
                price: "Custom",
                description: "Full platform, API access, dedicated support",
                cta: "Contact us",
                href: "mailto:hello@securelogicai.com",
                featured: false,
              },
            ].map((plan) => (
              <div
                key={plan.name}
                className={`rounded-xl p-6 text-left ${
                  plan.featured
                    ? "bg-teal-600 ring-2 ring-teal-400"
                    : "bg-slate-800 border border-slate-700"
                }`}
              >
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1">
                  {plan.name}
                </p>
                <p className="text-2xl font-bold mb-3">{plan.price}</p>
                <p className={`text-sm leading-relaxed mb-5 ${plan.featured ? "text-teal-100" : "text-slate-400"}`}>
                  {plan.description}
                </p>
                <a
                  href={plan.href}
                  className={`block text-center py-2 px-4 rounded-lg text-sm font-semibold transition-colors ${
                    plan.featured
                      ? "bg-white text-teal-700 hover:bg-teal-50"
                      : "bg-slate-700 text-white hover:bg-slate-600"
                  }`}
                >
                  {plan.cta}
                </a>
              </div>
            ))}
          </div>

          <Link
            href="/pricing/"
            className="text-sm text-slate-400 hover:text-white transition-colors underline underline-offset-2"
          >
            View full pricing details
          </Link>
        </div>
      </section>

      {/* ── Bottom CTA ────────────────────────────────────────────────────── */}
      <section className="py-24 px-4 bg-white">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-5 leading-tight">
            Your risk exposure doesn&apos;t wait.<br className="hidden sm:block" />
            Your intelligence shouldn&apos;t either.
          </h2>
          <p className="text-slate-500 mb-10 leading-relaxed max-w-lg mx-auto">
            Join security and compliance teams using SecureLogic AI to stay ahead of vendor risk,
            regulatory change, and emerging threats — with intelligence that&apos;s already scored,
            synthesized, and ready to act on.
          </p>
          <a
            href="https://app.securelogicai.com/register"
            className="inline-flex items-center px-8 py-3.5 rounded-lg bg-teal-600 text-white font-semibold hover:bg-teal-700 transition-colors"
          >
            Get started free
          </a>
          <p className="mt-4 text-xs text-slate-400">No credit card required · Cancel any time</p>
        </div>
      </section>
    </>
  );
}
