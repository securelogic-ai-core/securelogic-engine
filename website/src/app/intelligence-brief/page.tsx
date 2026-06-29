import type { Metadata } from "next";
import Link from "next/link";
import { getPricingTiers } from "@/lib/pricing";

export const metadata: Metadata = {
  title: "Intelligence Brief",
  description:
    "A weekly executive-grade risk intelligence briefing from SecureLogic AI — covering vendor risk, regulatory changes, security threats, and AI governance developments.",
};

export default function IntelligenceBriefPage() {
  const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.securelogicai.com";
  // Price + features sourced from the shared pricing model so this page can
  // never drift from the rebuilt home/pricing pages.
  const briefPro = getPricingTiers(APP_URL).find((t) => t.id === "brief-pro")!;

  return (
    <>
      {/* Hero */}
      <section className="bg-navy-900 text-white pt-20 pb-24 px-4 relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          aria-hidden="true"
          style={{
            background:
              "radial-gradient(ellipse 70% 60% at 50% 100%, rgba(13,148,136,0.18) 0%, transparent 65%), radial-gradient(ellipse 40% 40% at 50% 80%, rgba(6,78,100,0.25) 0%, transparent 60%)",
          }}
        />
        <div className="relative max-w-3xl mx-auto text-center">
          <span className="inline-block text-xs font-bold text-teal-400 uppercase tracking-widest mb-4">
            SecureLogic AI · Available Now
          </span>
          <h1 className="text-5xl sm:text-6xl font-extrabold leading-tight tracking-tight mb-6">
            Intelligence Brief
          </h1>
          <p className="text-lg text-slate-300 leading-relaxed mb-8 max-w-2xl mx-auto">
            Weekly executive-grade risk intelligence — synthesized from hundreds of signals across
            security, regulatory, vendor risk, and AI governance sources.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/#brief-signup"
              className="inline-flex items-center justify-center px-6 py-3 rounded-lg bg-teal-600 text-white font-semibold hover:bg-teal-500 transition-colors text-sm"
            >
              Get the Free Brief
            </Link>
            <a
              href={`${APP_URL}/signup?plan=professional`}
              className="inline-flex items-center justify-center px-6 py-3 rounded-lg border border-slate-600 text-slate-200 font-semibold hover:border-slate-400 hover:text-white transition-colors text-sm"
            >
              Start Brief Pro
            </a>
          </div>
        </div>
      </section>

      {/* What's included */}
      <section className="py-20 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-2xl font-bold text-slate-900 mb-3">What every issue includes</h2>
            <p className="text-slate-500 max-w-xl mx-auto">
              Built for security leaders who need to understand risk exposure without spending hours
              aggregating sources.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                title: "Risk snapshot",
                description:
                  "Critical, High, Medium, and Low signal counts at a glance. Know your risk posture the moment you open it.",
              },
              {
                title: "Executive synthesis",
                description:
                  "An opening summary written for executive audiences — the week's most important risk developments, in plain language.",
              },
              {
                title: "Security advisories",
                description:
                  "Vulnerability disclosures, active exploitation reports, and patch urgency assessments relevant to enterprise environments.",
              },
              {
                title: "Vendor risk intelligence",
                description:
                  "Third-party and supply chain risk events — vendor breaches, incidents, and critical security updates from SecurityWeek and Dark Reading.",
              },
              {
                title: "Regulatory updates",
                description:
                  "Compliance deadlines, regulatory guidance, enforcement actions, and framework changes across global jurisdictions.",
              },
              {
                title: "AI governance developments",
                description:
                  "AI policy, EU AI Act, ISO 42001, model risk, and AI system governance developments affecting enterprise AI adoption.",
              },
            ].map((item) => (
              <div key={item.title} className="bg-white rounded-xl border border-slate-200 p-7 shadow-sm hover:border-teal-300/60 hover:shadow-md hover:shadow-teal-500/5 transition-all">
                <h3 className="font-semibold text-slate-900 mb-2">{item.title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Sample signals */}
      <section className="bg-slate-900 py-20 px-4 text-white">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-2xl font-bold mb-3">Format preview</h2>
            <p className="text-slate-400 text-sm">This is the structure and format of a real issue. Content is illustrative.</p>
          </div>

          <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
            {/* Brief header mock */}
            <div className="p-6 border-b border-slate-700">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-teal-400 font-semibold uppercase tracking-wider">SecureLogic AI · Intelligence Brief</p>
                <span className="text-xs text-slate-500">Weekly Edition</span>
              </div>
              <p className="text-sm text-slate-300 leading-relaxed">
                <span className="font-medium text-white">Executive synthesis: </span>
                This week's brief captures an elevated threat environment, with three critical-severity
                findings requiring immediate action. The convergence of active zero-day exploitation,
                a major vendor supply chain incident, and new EU AI Act enforcement guidance creates
                compounding exposure for organizations operating across regulated sectors.
              </p>
            </div>

            {/* Risk counts */}
            <div className="px-6 py-4 flex gap-3 border-b border-slate-700">
              <span className="px-3 py-1 bg-red-900/50 text-red-300 text-xs font-semibold rounded-full border border-red-800/40">3 Critical</span>
              <span className="px-3 py-1 bg-orange-900/50 text-orange-300 text-xs font-semibold rounded-full border border-orange-800/40">7 High</span>
              <span className="px-3 py-1 bg-yellow-900/40 text-yellow-300 text-xs font-semibold rounded-full border border-yellow-800/40">12 Medium</span>
              <span className="px-3 py-1 bg-slate-700 text-slate-300 text-xs font-semibold rounded-full">9 Low</span>
            </div>

            {/* Signal cards */}
            <div className="divide-y divide-slate-700/60">
              {[
                {
                  tag: "VENDOR RISK",
                  severity: "CRITICAL",
                  title: "Critical patch issued for widely-deployed network appliance",
                  body: "A critical-severity vulnerability in a major enterprise network appliance is under active exploitation. Vendors have issued an emergency patch. Organizations should prioritize immediate patching or temporary mitigation.",
                  action: "Audit affected appliance versions in your environment and apply vendor patch within 24–48 hours.",
                },
                {
                  tag: "REGULATORY",
                  severity: "HIGH",
                  title: "EU AI Act enforcement timeline confirmed for high-risk systems",
                  body: "The European Commission has confirmed enforcement timelines for high-risk AI system requirements. Organizations deploying AI in regulated categories face compliance obligations with significant lead time required.",
                  action: "Initiate AI system inventory review against EU AI Act Annex III classification criteria.",
                },
              ].map((signal) => (
                <div key={signal.title} className="p-5">
                  <div className="flex items-center gap-2.5 mb-2">
                    <span className="text-[10px] font-bold text-teal-400 bg-teal-900/40 px-2 py-0.5 rounded uppercase tracking-wide">
                      {signal.tag}
                    </span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wide ${
                      signal.severity === "CRITICAL"
                        ? "text-red-300 bg-red-900/40"
                        : "text-orange-300 bg-orange-900/40"
                    }`}>
                      {signal.severity}
                    </span>
                  </div>
                  <h4 className="font-semibold text-white text-sm mb-1.5">{signal.title}</h4>
                  <p className="text-slate-400 text-xs leading-relaxed mb-3">{signal.body}</p>
                  <div className="bg-teal-900/20 border border-teal-800/30 rounded-lg p-3">
                    <p className="text-xs text-teal-300">
                      <span className="font-semibold">Recommended action: </span>
                      {signal.action}
                    </p>
                  </div>
                </div>
              ))}

              <div className="p-5 text-center">
                <p className="text-sm text-slate-500">
                  + 29 more signals this issue — available to subscribers
                </p>
                <a
                  href={`${APP_URL}/signup?plan=professional`}
                  className="mt-3 inline-flex items-center px-4 py-2 rounded-lg bg-teal-600 text-white text-xs font-semibold hover:bg-teal-500 transition-colors"
                >
                  Subscribe to read full brief
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing CTA */}
      <section className="py-20 px-4">
        <div className="max-w-xl mx-auto text-center">
          <h2 className="text-2xl font-bold text-slate-900 mb-3">Get the Intelligence Brief</h2>
          <p className="text-slate-500 mb-8 leading-relaxed">
            Full access to every issue — all signals, recommendations, and the executive synthesis.
            Cancel any time.
          </p>
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-8 mb-6">
            <p className="text-xs text-slate-400 uppercase tracking-wider font-medium mb-1">{briefPro.name}</p>
            <div className="flex items-baseline justify-center gap-1.5 mb-1">
              <p className="text-4xl font-bold text-slate-900">{briefPro.price}</p>
              <span className="text-sm text-slate-500">per month</span>
            </div>
            <p className="text-sm text-slate-500 mb-6">{briefPro.tagline}</p>
            <ul className="text-sm text-slate-600 space-y-2.5 text-left mb-8">
              {briefPro.features.map((f) => (
                <li key={f} className="flex items-start gap-2.5">
                  <span className="mt-0.5 w-4 h-4 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center flex-shrink-0">
                    <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                  {f}
                </li>
              ))}
            </ul>
            <a
              href={`${APP_URL}/signup?plan=professional`}
              className="block w-full text-center py-3 px-6 rounded-lg bg-teal-600 text-white font-semibold hover:bg-teal-500 transition-colors"
            >
              Start Brief Pro
            </a>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed">
            Prefer to start free? The weekly{" "}
            <Link href="/#brief-signup" className="text-teal-600 hover:underline">
              Intelligence Brief is free
            </Link>{" "}
            — no credit card. Need team distribution or the full risk platform? Compare
            Team Professional and Platform Professional on the{" "}
            <Link href="/pricing/" className="text-teal-600 hover:underline">
              pricing page
            </Link>
            .
          </p>
        </div>
      </section>
    </>
  );
}
