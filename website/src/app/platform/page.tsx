import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Platform",
  description:
    "The SecureLogic AI platform — Vendor Risk, AI Governance, Compliance, and Intelligence modules for unified risk coverage.",
};

export default function PlatformPage() {
  return (
    <>
      {/* Header */}
      <section className="relative overflow-hidden bg-navy-900 text-white pt-20 pb-24 px-4">
        <div
          className="absolute inset-0 pointer-events-none"
          aria-hidden="true"
          style={{ background: "radial-gradient(ellipse 60% 80% at 50% 120%, rgba(13,148,136,0.15) 0%, transparent 65%)" }}
        />
        <div className="relative max-w-3xl mx-auto text-center">
          <span className="inline-block text-xs font-bold text-teal-400 uppercase tracking-widest mb-4">
            Platform Overview
          </span>
          <h1 className="text-5xl sm:text-6xl font-extrabold leading-tight tracking-tight mb-6">
            One platform for<br />total risk coverage
          </h1>
          <p className="text-lg text-slate-300 leading-relaxed max-w-2xl mx-auto">
            SecureLogic AI brings vendor risk, AI governance, compliance, and threat intelligence
            into a single analytical platform — powered by the SecureLogic Engine.
          </p>
        </div>
      </section>

      {/* Engine layer */}
      <section className="py-16 px-4 bg-slate-50 border-b border-slate-200">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-xl font-bold text-slate-900 mb-3">Powered by the SecureLogic Engine</h2>
          <p className="text-slate-500 max-w-2xl mx-auto text-sm leading-relaxed">
            Every module is built on top of the same analytical core — a risk scoring and insight
            generation engine that transforms raw signals into explainable, repeatable, actionable
            intelligence. No isolated tools. No duplicated logic.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3 text-xs font-medium">
            {["Risk scoring engine", "Signal ingestion", "Insight generation", "Entitlement system", "API layer", "Audit logging"].map((f) => (
              <span key={f} className="px-3 py-1.5 bg-white border border-slate-200 rounded-full text-slate-600 shadow-sm">
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
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-teal-50 text-teal-700 border border-teal-200">
                  Available now
                </span>
              </div>
              <h2 className="text-2xl font-bold text-slate-900 mb-4">Intelligence</h2>
              <p className="text-slate-500 leading-relaxed mb-5">
                Continuous external signal monitoring across security, regulatory, vendor risk, and
                AI governance sources — synthesized into the weekly Intelligence Brief.
              </p>
              <ul className="space-y-2 text-sm text-slate-600 mb-6">
                {[
                  "Weekly Intelligence Brief delivery",
                  "Risk-scored signals by category",
                  "Executive synthesis and recommendations",
                  "Vendor risk, security, regulatory, and AI feeds",
                ].map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-teal-500 flex-shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              <Link
                href="/intelligence-brief/"
                className="inline-flex items-center px-5 py-2.5 rounded-lg bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 transition-colors"
              >
                Learn more about the Intelligence Brief
              </Link>
            </div>
            <div className="bg-slate-900 rounded-xl p-6 text-white">
              <p className="text-xs text-teal-400 font-semibold uppercase tracking-wider mb-3">
                Intelligence Brief
              </p>
              <div className="flex gap-2 mb-5">
                <span className="px-2.5 py-1 bg-red-900/50 text-red-300 text-xs font-semibold rounded-full border border-red-800/40">3 Critical</span>
                <span className="px-2.5 py-1 bg-orange-900/50 text-orange-300 text-xs font-semibold rounded-full border border-orange-800/40">7 High</span>
              </div>
              <div className="space-y-2">
                {["Security advisory — CVE-2026-XXXX", "Regulatory — EU AI Act update", "Vendor risk — Supply chain incident"].map((s) => (
                  <div key={s} className="text-xs text-slate-400 bg-slate-800 rounded-lg px-3 py-2">{s}</div>
                ))}
              </div>
            </div>
          </div>

          <div className="border-t border-slate-100" />

          {/* Vendor Risk */}
          <div id="vendor-risk" className="grid md:grid-cols-2 gap-10 items-center">
            <div className="md:order-2">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-500">
                  In development
                </span>
              </div>
              <h2 className="text-2xl font-bold text-slate-900 mb-4">Vendor Risk</h2>
              <p className="text-slate-500 leading-relaxed mb-5">
                Continuous third-party risk monitoring, assessment, and scoring. Onboard vendors,
                track risk posture, and get alerted when your supply chain exposure changes.
              </p>
              <ul className="space-y-2 text-sm text-slate-600">
                {[
                  "Vendor inventory and onboarding",
                  "Risk scoring and trending",
                  "Assessment intake and findings",
                  "Document ingestion (SOC 2, ISO 27001)",
                  "Continuous monitoring and alerts",
                ].map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-300 flex-shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
            <div className="md:order-1 bg-slate-50 rounded-xl border border-slate-200 p-8 text-center">
              <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center mx-auto mb-4 text-slate-500">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
              </div>
              <p className="text-sm font-medium text-slate-700 mb-2">Vendor Risk module</p>
              <p className="text-xs text-slate-400 mb-4">In active development. Enterprise early access available.</p>
              <a href="mailto:hello@securelogicai.com" className="text-xs font-semibold text-teal-600 hover:text-teal-700 transition-colors">
                Request early access →
              </a>
            </div>
          </div>

          <div className="border-t border-slate-100" />

          {/* AI Governance */}
          <div id="ai-governance" className="grid md:grid-cols-2 gap-10 items-center">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-500">
                  In development
                </span>
              </div>
              <h2 className="text-2xl font-bold text-slate-900 mb-4">AI Governance</h2>
              <p className="text-slate-500 leading-relaxed mb-5">
                Inventory, assess, and govern AI systems across your organization against ISO 42001,
                EU AI Act, and internal policy frameworks.
              </p>
              <ul className="space-y-2 text-sm text-slate-600">
                {[
                  "AI system inventory",
                  "Governance assessment framework",
                  "ISO 42001 and EU AI Act mapping",
                  "Model risk classification",
                  "Policy compliance tracking",
                ].map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-300 flex-shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
            <div className="bg-slate-50 rounded-xl border border-slate-200 p-8 text-center">
              <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center mx-auto mb-4 text-slate-500">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 3H7a2 2 0 00-2 2v2m4-4h6m-6 0V1m6 2h2a2 2 0 012 2v2m0 0V9m0-2h2M21 9v6m0 0v2a2 2 0 01-2 2h-2m0 0H9m6 0v2m-6-2H7a2 2 0 01-2-2v-2m0 0V9m0 6H3M3 9V7a2 2 0 012-2h2m2 4h6v6H9V9z" />
                </svg>
              </div>
              <p className="text-sm font-medium text-slate-700 mb-2">AI Governance module</p>
              <p className="text-xs text-slate-400 mb-4">In active development. Enterprise early access available.</p>
              <a href="mailto:hello@securelogicai.com" className="text-xs font-semibold text-teal-600 hover:text-teal-700 transition-colors">
                Request early access →
              </a>
            </div>
          </div>

          <div className="border-t border-slate-100" />

          {/* Compliance */}
          <div id="compliance" className="grid md:grid-cols-2 gap-10 items-center">
            <div className="md:order-2">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-slate-100 text-slate-500">
                  In development
                </span>
              </div>
              <h2 className="text-2xl font-bold text-slate-900 mb-4">Compliance</h2>
              <p className="text-slate-500 leading-relaxed mb-5">
                Map controls to SOC 2, NIST CSF, ISO 27001, and more. Track gaps, manage evidence,
                and produce audit-ready reports continuously.
              </p>
              <ul className="space-y-2 text-sm text-slate-600">
                {[
                  "Framework registry (SOC 2, NIST, ISO)",
                  "Control mapping and gap analysis",
                  "Evidence tracking",
                  "Continuous compliance monitoring",
                  "Audit-ready reporting",
                ].map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-300 flex-shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
            <div className="md:order-1 bg-slate-50 rounded-xl border border-slate-200 p-8 text-center">
              <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center mx-auto mb-4 text-slate-500">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <p className="text-sm font-medium text-slate-700 mb-2">Compliance module</p>
              <p className="text-xs text-slate-400 mb-4">In active development. Enterprise early access available.</p>
              <a href="mailto:hello@securelogicai.com" className="text-xs font-semibold text-teal-600 hover:text-teal-700 transition-colors">
                Request early access →
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* Enterprise CTA */}
      <section className="bg-slate-900 py-16 px-4 text-white text-center">
        <div className="max-w-xl mx-auto">
          <h2 className="text-2xl font-bold mb-3">Interested in enterprise access?</h2>
          <p className="text-slate-400 mb-7 text-sm leading-relaxed">
            Get early access to platform modules as they launch. We work directly with enterprise
            teams on requirements and onboarding.
          </p>
          <a
            href="mailto:hello@securelogicai.com"
            className="inline-flex items-center px-7 py-3 rounded-lg bg-teal-600 text-white font-semibold hover:bg-teal-500 transition-colors text-sm"
          >
            Contact us about enterprise
          </a>
        </div>
      </section>
    </>
  );
}
