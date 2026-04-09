import type { Metadata } from "next";
import Image from "next/image";
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
  const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.securelogicai.com";

  return (
    <>
      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="relative bg-navy-900 text-white overflow-hidden min-h-[calc(100vh-64px)] flex items-center">

        {/* Background: layered atmospheric glows + technical grid */}
        <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
          {/* Outer deep blue-teal pool */}
          <div style={{
            position: "absolute", inset: 0,
            background: "radial-gradient(ellipse 80% 80% at 5% 50%, rgba(6,78,100,0.38) 0%, transparent 60%)",
          }} />
          {/* Inner brand teal — tighter, brighter */}
          <div style={{
            position: "absolute", inset: 0,
            background: "radial-gradient(ellipse 45% 55% at 5% 50%, rgba(13,148,136,0.20) 0%, transparent 55%)",
          }} />
          {/* Technical grid */}
          <div style={{
            position: "absolute", inset: 0,
            opacity: 0.055,
            backgroundImage:
              "linear-gradient(rgba(45,212,191,1) 1px, transparent 1px), linear-gradient(90deg, rgba(45,212,191,1) 1px, transparent 1px)",
            backgroundSize: "56px 56px",
          }} />
          {/* Edge vignette */}
          <div style={{
            position: "absolute", inset: 0,
            background: "radial-gradient(ellipse 110% 110% at 50% 50%, transparent 35%, rgba(10,15,30,0.90) 100%)",
          }} />
        </div>

        <div className="relative w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 lg:py-28">
          <div className="grid lg:grid-cols-[1fr_460px] xl:grid-cols-[1fr_500px] gap-14 xl:gap-20 items-center">

            {/* ── Left: text ── */}
            <div>
              {/* Brand eyebrow */}
              <div className="mb-6">
                <Image
                  src="/branding/securelogic-ai-logo.png"
                  alt=""
                  width={52}
                  height={52}
                  className="h-12 w-12 rounded-2xl mb-5 flex-shrink-0"
                  aria-hidden="true"
                />
                <p className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-teal-600/10 border border-teal-700/30 text-xs font-semibold uppercase tracking-[0.16em] text-teal-400">
                  SecureLogic AI <span className="opacity-40">·</span> Unified Risk Intelligence
                </p>
              </div>

              {/* Lockup separator */}
              <div className="w-10 h-px bg-teal-600/50 mb-10" />

              {/* Headline — crescendo: small lead-in → dominant → teal payoff */}
              <h1 className="font-extrabold leading-none tracking-tight mb-8">
                <span className="block text-3xl sm:text-4xl lg:text-5xl text-slate-300 mb-2">
                  Unified risk
                </span>
                <span className="block text-5xl sm:text-6xl lg:text-7xl xl:text-[5.25rem] text-white">
                  intelligence
                </span>
                <span className="block text-5xl sm:text-6xl lg:text-7xl xl:text-[5.25rem] text-teal-400 mt-1">
                  for the enterprise.
                </span>
              </h1>

              {/* Subtitle */}
              <p className="text-[17px] text-slate-300 leading-relaxed max-w-[460px] mb-10">
                SecureLogic AI continuously monitors vendors, compliance
                frameworks, AI systems, and external threats — scoring every
                signal and delivering decision-ready intelligence to your team.
              </p>

              {/* CTAs */}
              <div className="flex flex-col sm:flex-row gap-3 mb-12">
                <a
                  href={`${APP_URL}/register`}
                  className="inline-flex items-center justify-center px-7 py-3.5 rounded-lg bg-teal-600 text-white font-semibold hover:bg-teal-500 transition-colors text-sm shadow-[0_1px_0_rgba(255,255,255,0.12)_inset,0_4px_20px_rgba(13,148,136,0.30)]"
                >
                  Start free
                </a>
                <Link
                  href="/intelligence-brief/"
                  className="inline-flex items-center justify-center gap-1.5 px-7 py-3.5 rounded-lg border border-slate-600 text-slate-200 font-semibold hover:border-teal-500/60 hover:text-white hover:bg-white/5 transition-colors text-sm"
                >
                  See the Intelligence Brief
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              </div>

              {/* Proof strip */}
              <div className="flex flex-wrap gap-x-7 gap-y-2 pt-7 border-t border-slate-800">
                {[
                  "22+ signal sources",
                  "4 risk domains",
                  "Risk-scored weekly",
                  "From $39/mo",
                ].map((item) => (
                  <span key={item} className="flex items-center gap-2 text-xs text-slate-400 font-medium">
                    <span className="w-2 h-2 rounded-full bg-teal-500 flex-shrink-0" />
                    <span className="text-white">{item}</span>
                  </span>
                ))}
              </div>
            </div>

            {/* ── Right: Intelligence Brief document ── */}
            <div
              className="relative rounded-2xl overflow-hidden flex-shrink-0"
              style={{
                boxShadow:
                  "0 0 0 1px rgba(45,212,191,0.18), 0 0 80px rgba(13,148,136,0.16), 0 32px 80px rgba(0,0,0,0.6)",
              }}
            >
              {/* Document header — executive artifact framing */}
              <div className="bg-[#0a1628] border-b border-slate-700/60 px-5 py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <Image
                      src="/branding/securelogic-ai-logo.png"
                      alt=""
                      width={18}
                      height={18}
                      className="rounded opacity-80 flex-shrink-0"
                    />
                    <div className="leading-none">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-teal-400 leading-none mb-1">
                        Intelligence Brief
                      </p>
                      <p className="text-[11px] text-slate-400 font-medium leading-none">
                        SecureLogic AI · Issue #12
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-slate-500 font-medium">Apr 7, 2026</p>
                    <p className="text-[9px] text-slate-600 uppercase tracking-wider mt-0.5">Weekly Edition</p>
                  </div>
                </div>
              </div>

              <div className="bg-slate-900 p-5">
                {/* Risk snapshot — large numbers */}
                <div className="bg-slate-800/50 rounded-xl p-4 mb-4 border border-slate-700/40">
                  <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold mb-4">
                    Risk Snapshot
                  </p>
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { count: "3",  label: "Critical", color: "text-red-400"    },
                      { count: "7",  label: "High",     color: "text-orange-400" },
                      { count: "12", label: "Medium",   color: "text-yellow-400" },
                      { count: "9",  label: "Low",       color: "text-slate-500"  },
                    ].map((item) => (
                      <div key={item.label} className="text-center">
                        <p className={`text-2xl font-extrabold leading-none tabular-nums ${item.color}`}>
                          {item.count}
                        </p>
                        <p className="text-[9px] text-slate-500 uppercase tracking-wide mt-1.5 leading-none">
                          {item.label}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Signal list */}
                <div className="space-y-2">
                  {[
                    {
                      category: "VENDOR RISK",
                      severity: "CRITICAL",
                      severityColor: "text-red-400",
                      barColor: "bg-red-500/70",
                      title: "Critical patch issued for widely-deployed network appliance",
                    },
                    {
                      category: "REGULATORY",
                      severity: "HIGH",
                      severityColor: "text-orange-400",
                      barColor: "bg-orange-500/70",
                      title: "EU AI Act enforcement timeline confirmed for high-risk systems",
                    },
                    {
                      category: "SECURITY",
                      severity: "CRITICAL",
                      severityColor: "text-red-400",
                      barColor: "bg-red-500/70",
                      title: "Zero-day affecting enterprise VPN solutions under active exploitation",
                    },
                  ].map((signal) => (
                    <div
                      key={signal.title}
                      className="flex overflow-hidden rounded-lg border border-slate-700/30"
                    >
                      <div className={`w-1 flex-shrink-0 ${signal.barColor}`} />
                      <div className="flex-1 bg-slate-800/50 px-3 py-2.5">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-[10px] font-bold text-teal-500 uppercase tracking-wide">
                            {signal.category}
                          </span>
                          <span className="text-slate-700 text-[10px]">·</span>
                          <span className={`text-[10px] font-bold uppercase tracking-wide ${signal.severityColor}`}>
                            {signal.severity}
                          </span>
                        </div>
                        <p className="text-xs text-slate-300 leading-snug">{signal.title}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-4 pt-3.5 border-t border-slate-800 flex items-center justify-between">
                  <p className="text-[11px] text-slate-600">
                    + 28 more signals — subscribers only
                  </p>
                  <a
                    href={`${APP_URL}/register?plan=professional`}
                    className="text-[11px] font-semibold text-teal-400 hover:text-teal-300 transition-colors"
                  >
                    Subscribe →
                  </a>
                </div>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* ── Platform modules ──────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-navy-900 border-t border-slate-700/50 py-24 px-4">
        <div
          className="absolute inset-0 pointer-events-none"
          aria-hidden="true"
          style={{ background: "radial-gradient(ellipse 50% 30% at 50% 0%, rgba(13,148,136,0.07) 0%, transparent 70%)" }}
        />
        <div className="relative max-w-6xl mx-auto">
          <div className="mb-12">
            <p className="text-xs font-bold text-teal-400 uppercase tracking-widest mb-4">
              Platform
            </p>
            <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5">
              <h2 className="text-4xl font-bold text-white leading-tight max-w-sm">
                One platform.<br />Total risk coverage.
              </h2>
              <p className="text-slate-400 max-w-md leading-relaxed text-sm lg:text-right">
                SecureLogic AI unifies the risk domains that matter most to modern
                enterprises — so you stop chasing gaps across disconnected tools.
              </p>
            </div>
          </div>

          {/* Unified panel with hairline dividers */}
          <div className="relative">
            <div
              className="absolute -inset-px rounded-2xl pointer-events-none"
              aria-hidden="true"
              style={{ boxShadow: "0 0 100px rgba(13,148,136,0.13)" }}
            />
          <div
            className="rounded-2xl overflow-hidden border border-slate-700/40"
            style={{ background: "rgba(51,65,85,0.35)" }}
          >
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-px">
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
                <div
                  key={module.title}
                  className={`bg-navy-900 p-7 hover:bg-slate-800/20 transition-colors ${module.available ? "border-t-2 border-teal-500/40" : ""}`}
                >
                  <div
                    className={`w-10 h-10 rounded-lg flex items-center justify-center mb-5 ${
                      module.available
                        ? "bg-teal-600/20 text-teal-400"
                        : "bg-slate-800 text-slate-500"
                    }`}
                  >
                    <module.Icon />
                  </div>
                  <h3 className="font-semibold text-white mb-2 text-sm">{module.title}</h3>
                  <p className="text-xs text-slate-400 leading-relaxed mb-5">{module.description}</p>
                  <span
                    className={`text-[10px] font-bold uppercase tracking-widest px-2.5 py-1 rounded-full ${
                      module.available
                        ? "bg-teal-600/15 text-teal-400 border border-teal-700/40"
                        : "bg-slate-800 text-slate-600 border border-slate-700/40"
                    }`}
                  >
                    {module.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
          </div>

          <div className="mt-8 flex items-center justify-between">
            <Link
              href="/platform/"
              className="inline-flex items-center text-sm font-medium text-teal-400 hover:text-teal-300 transition-colors"
            >
              Explore the platform roadmap
              <svg className="ml-1.5 w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
            <p className="text-xs text-slate-600 hidden sm:block">
              Enterprise customers get early module access
            </p>
          </div>
        </div>
      </section>

      {/* ── Intelligence Brief spotlight ──────────────────────────────────── */}
      <section className="bg-slate-50 border-t-2 border-teal-600/40 py-24 px-4">
        <div className="max-w-6xl mx-auto">
          <div className="grid md:grid-cols-2 gap-16 items-start">

            {/* Left */}
            <div>
              <p className="text-xs font-bold text-teal-600 uppercase tracking-widest mb-5">
                Available now
              </p>
              <h2 className="text-4xl font-bold text-slate-900 mb-6 leading-tight">
                The SecureLogic AI<br />Intelligence Brief
              </h2>
              <p className="text-[15px] text-slate-600 leading-relaxed mb-10">
                A weekly executive-grade risk intelligence briefing built from
                hundreds of signals across security advisories, regulatory updates,
                vendor risk events, and AI governance developments — synthesized
                into decision-ready intelligence your team can act on immediately.
              </p>

              <div className="space-y-5 mb-10">
                {[
                  {
                    label: "Curated signal coverage",
                    detail: "Security, regulatory, vendor risk, and AI governance sources — monitored continuously",
                  },
                  {
                    label: "Risk-scored and prioritized",
                    detail: "Every finding ranked by impact, novelty, and urgency using the SecureLogic Engine",
                  },
                  {
                    label: "Recommended actions included",
                    detail: "Decision-ready guidance per finding — not raw data, not summaries",
                  },
                  {
                    label: "Executive synthesis",
                    detail: "Opening analysis written for leadership distribution — distribute directly",
                  },
                ].map((item) => (
                  <div key={item.label} className="flex items-start gap-4">
                    <div className="w-5 h-5 rounded-full bg-teal-50 border border-teal-200 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <svg className="w-2.5 h-2.5 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-800 mb-0.5">{item.label}</p>
                      <p className="text-xs text-slate-500 leading-relaxed">{item.detail}</p>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-5">
                <a
                  href={`${APP_URL}/register?plan=professional`}
                  className="inline-flex items-center px-6 py-3 rounded-lg bg-teal-600 text-white text-sm font-semibold hover:bg-teal-500 transition-colors"
                >
                  Subscribe to the Intelligence Brief
                </a>
                <span className="text-sm text-slate-400">$39 / month</span>
              </div>
              <div className="mt-4">
                <Link
                  href="/intelligence-brief/"
                  className="inline-flex items-center text-sm font-medium text-slate-500 hover:text-slate-800 transition-colors"
                >
                  See what&apos;s included
                  <svg className="ml-1.5 w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </Link>
              </div>
            </div>

            {/* Right: sample brief — same document framing as hero card */}
            <div
              className="bg-slate-900 rounded-2xl overflow-hidden border border-slate-700/50"
              style={{ boxShadow: "0 0 0 1px rgba(45,212,191,0.12), 0 0 60px rgba(13,148,136,0.12), 0 24px 60px rgba(0,0,0,0.4)" }}
            >
              {/* Document header */}
              <div className="bg-[#0a1628] border-b border-slate-700/60 px-5 py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <Image
                      src="/branding/securelogic-ai-logo.png"
                      alt=""
                      width={18}
                      height={18}
                      className="rounded opacity-80 flex-shrink-0"
                    />
                    <div className="leading-none">
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-teal-400 leading-none mb-1">
                        Intelligence Brief
                      </p>
                      <p className="text-[11px] text-slate-400 font-medium leading-none">
                        SecureLogic AI · Issue #12
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-slate-500 font-medium">Apr 7, 2026</p>
                    <p className="text-[9px] text-slate-600 uppercase tracking-wider mt-0.5">Weekly Edition</p>
                  </div>
                </div>
              </div>

              {/* Executive synthesis */}
              <div className="px-6 py-5 border-b border-slate-800 bg-slate-800/20">
                <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold mb-2.5">
                  Executive Synthesis
                </p>
                <p className="text-xs text-slate-300 leading-relaxed">
                  <span className="text-white font-semibold">Elevated threat environment this week. </span>
                  Three critical findings require immediate action. The convergence of active zero-day
                  exploitation, a major vendor supply chain incident, and new EU AI Act enforcement
                  guidance creates compounding exposure for organizations in regulated sectors.
                </p>
              </div>

              {/* Signals with severity left-bar */}
              <div className="divide-y divide-slate-800/60 px-2 py-2">
                {[
                  {
                    category: "VENDOR RISK",
                    severity: "CRITICAL",
                    severityColor: "text-red-400",
                    barColor: "bg-red-500/70",
                    title: "Critical patch issued for widely-deployed network appliance",
                    action: "Apply vendor patch within 24–48 hours.",
                  },
                  {
                    category: "REGULATORY",
                    severity: "HIGH",
                    severityColor: "text-orange-400",
                    barColor: "bg-orange-500/70",
                    title: "EU AI Act enforcement timeline confirmed for high-risk systems",
                    action: "Initiate AI system inventory review against EU AI Act Annex III.",
                  },
                ].map((signal) => (
                  <div
                    key={signal.title}
                    className="flex overflow-hidden rounded-xl my-1"
                  >
                    <div className={`w-1 flex-shrink-0 ${signal.barColor} rounded-l-xl`} />
                    <div className="flex-1 bg-slate-800/30 px-4 py-4">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[10px] font-bold text-teal-500 uppercase tracking-wide">
                          {signal.category}
                        </span>
                        <span className="text-slate-700">·</span>
                        <span className={`text-[10px] font-bold uppercase tracking-wide ${signal.severityColor}`}>
                          {signal.severity}
                        </span>
                      </div>
                      <p className="text-sm text-white font-medium mb-3 leading-snug">{signal.title}</p>
                      <div className="border-l-2 border-teal-600/50 pl-3">
                        <p className="text-[11px] text-teal-300 leading-relaxed">
                          <span className="font-semibold">Action: </span>{signal.action}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="px-6 py-4 border-t border-slate-800 flex items-center justify-between">
                <p className="text-xs text-slate-600">+ 29 more signals this issue</p>
                <a
                  href={`${APP_URL}/register?plan=professional`}
                  className="text-xs font-semibold text-teal-400 hover:text-teal-300 transition-colors"
                >
                  Subscribe to read →
                </a>
              </div>
            </div>

          </div>
        </div>
      </section>

      {/* ── Pricing ───────────────────────────────────────────────────────── */}
      <section className="bg-slate-950 border-t border-slate-800 py-24 px-4 text-white">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <p className="text-xs font-bold text-teal-400 uppercase tracking-widest mb-4">Pricing</p>
            <h2 className="text-4xl font-bold mb-4 leading-tight">
              Start with intelligence.<br />Scale to the platform.
            </h2>
            <p className="text-slate-400 max-w-md mx-auto leading-relaxed text-sm">
              Access the Intelligence Brief today. Full platform access available as modules launch.
            </p>
          </div>

          <div className="grid sm:grid-cols-3 gap-5 max-w-3xl mx-auto mb-10">
            {[
              {
                name: "Free",
                price: "$0",
                sub: "No credit card required",
                description: "Signal headlines, risk snapshot, and one brief preview.",
                cta: "Start free",
                href: `${APP_URL}/register`,
                featured: false,
              },
              {
                name: "Professional",
                price: "$39",
                sub: "per month",
                description: "Full Intelligence Brief — all signals, recommendations, and the executive synthesis.",
                cta: "Subscribe now",
                href: `${APP_URL}/register?plan=professional`,
                featured: true,
              },
              {
                name: "Enterprise",
                price: "Custom",
                sub: "contact us",
                description: "Full platform access, API, multi-user org accounts, and dedicated support.",
                cta: "Request a briefing",
                href: "mailto:hello@securelogicai.com",
                featured: false,
              },
            ].map((plan) => (
              <div
                key={plan.name}
                className={`rounded-2xl p-7 flex flex-col ${
                  plan.featured
                    ? "bg-teal-600 ring-2 ring-teal-400/60 shadow-[0_0_60px_rgba(13,148,136,0.35)] relative"
                    : "bg-slate-800 border border-slate-700"
                }`}
              >
                {plan.featured && (
                  <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                    <span className="bg-teal-400 text-teal-900 text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-wide whitespace-nowrap">
                      Most popular
                    </span>
                  </div>
                )}
                <div className="mb-6">
                  <p className={`text-[10px] font-bold uppercase tracking-widest mb-3 ${
                    plan.featured ? "text-teal-100" : "text-slate-400"
                  }`}>
                    {plan.name}
                  </p>
                  <div className="flex items-baseline gap-1.5 mb-1">
                    <span className="text-3xl font-extrabold">{plan.price}</span>
                    <span className={`text-sm ${plan.featured ? "text-teal-100" : "text-slate-500"}`}>
                      {plan.sub}
                    </span>
                  </div>
                  <p className={`text-sm leading-relaxed mt-3 ${
                    plan.featured ? "text-teal-100" : "text-slate-400"
                  }`}>
                    {plan.description}
                  </p>
                </div>
                <a
                  href={plan.href}
                  className={`mt-auto block text-center py-2.5 px-4 rounded-lg text-sm font-semibold transition-colors ${
                    plan.featured
                      ? "bg-white text-teal-700 hover:bg-teal-50"
                      : "bg-slate-700 text-white hover:bg-slate-600 border border-slate-600"
                  }`}
                >
                  {plan.cta}
                </a>
              </div>
            ))}
          </div>

          <div className="text-center">
            <Link
              href="/pricing/"
              className="text-sm text-slate-500 hover:text-teal-400 transition-colors"
            >
              View full pricing and feature comparison
            </Link>
          </div>
        </div>
      </section>

      {/* ── Bottom CTA ────────────────────────────────────────────────────── */}
      <section className="relative bg-navy-900 border-t border-slate-700/50 overflow-hidden py-28 px-4">
        <div
          className="absolute inset-0 pointer-events-none"
          aria-hidden="true"
          style={{
            background:
              "radial-gradient(ellipse 70% 70% at 50% 110%, rgba(13,148,136,0.14) 0%, transparent 65%)",
          }}
        />
        <div className="relative max-w-2xl mx-auto text-center">
          <div className="flex justify-center mb-8">
            <Image
              src="/branding/securelogic-ai-logo.png"
              alt="SecureLogic AI"
              width={52}
              height={52}
              className="rounded-xl"
            />
          </div>
          <h2 className="text-4xl sm:text-5xl font-extrabold text-white mb-6 leading-tight tracking-tight">
            Your risk exposure<br />
            <span className="text-teal-400">doesn&apos;t take weekends off.</span>
          </h2>
          <p className="text-slate-400 mb-10 leading-relaxed max-w-lg mx-auto">
            Join security and compliance teams using SecureLogic AI to stay ahead
            of vendor risk, regulatory change, and emerging threats — with
            intelligence that arrives scored, synthesized, and ready to act on.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <a
              href={`${APP_URL}/register`}
              className="inline-flex items-center justify-center px-8 py-3.5 rounded-lg bg-teal-600 text-white font-semibold hover:bg-teal-500 transition-colors"
            >
              Start free
            </a>
            <a
              href="mailto:hello@securelogicai.com"
              className="inline-flex items-center justify-center px-8 py-3.5 rounded-lg border border-slate-700 text-slate-300 font-semibold hover:border-slate-500 hover:text-white transition-colors"
            >
              Request a briefing
            </a>
          </div>
          <p className="mt-5 text-xs text-slate-600">No credit card required · Cancel any time</p>
        </div>
      </section>
    </>
  );
}
