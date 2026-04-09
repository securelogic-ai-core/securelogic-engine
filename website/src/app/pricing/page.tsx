import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "SecureLogic AI pricing — start with the Intelligence Brief at $39/month, or contact us for enterprise platform access.",
};

export default function PricingPage() {
  const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.securelogicai.com";

  return (
    <>
      {/* Header */}
      <section className="relative overflow-hidden bg-navy-900 border-b border-slate-800 pt-20 pb-20 px-4 text-center">
        <div
          className="absolute inset-0 pointer-events-none"
          aria-hidden="true"
          style={{ background: "radial-gradient(ellipse 60% 80% at 50% 120%, rgba(13,148,136,0.13) 0%, transparent 65%)" }}
        />
        <div className="relative max-w-2xl mx-auto">
          <p className="text-xs font-bold text-teal-400 uppercase tracking-widest mb-4">Pricing</p>
          <h1 className="text-4xl font-bold text-white mb-4">Simple, transparent pricing</h1>
          <p className="text-lg text-slate-400 leading-relaxed">
            Start with the Intelligence Brief. Scale to the full platform as your needs grow.
          </p>
        </div>
      </section>

      {/* Plans */}
      <section className="pt-14 pb-20 px-4">
        <div className="max-w-5xl mx-auto">
          <div className="grid sm:grid-cols-3 gap-6">
            {/* Free */}
            <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-md ring-1 ring-slate-200/60">
              <div className="mb-6">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Free</p>
                <div className="flex items-end gap-1 mb-3">
                  <span className="text-4xl font-bold text-slate-900">$0</span>
                </div>
                <p className="text-sm text-slate-500">Preview access. No credit card required.</p>
              </div>
              <a
                href={`${APP_URL}/register`}
                className="block w-full text-center py-2.5 px-5 rounded-lg border border-slate-300 text-slate-700 text-sm font-semibold hover:border-slate-400 transition-colors mb-8"
              >
                Get started free
              </a>
              <ul className="space-y-3 text-sm text-slate-600">
                {[
                  "Signal headlines and categories",
                  "Risk snapshot counts",
                  "1 brief issue preview",
                  "Platform access (when available)",
                ].map((f) => (
                  <li key={f} className="flex items-start gap-2.5">
                    <span className="mt-0.5 w-4 h-4 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center flex-shrink-0">
                      <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    {f}
                  </li>
                ))}
              </ul>
            </div>

            {/* Professional */}
            <div className="bg-teal-600 rounded-2xl p-8 text-white shadow-lg ring-2 ring-teal-400 relative">
              <div className="absolute -top-3.5 left-1/2 -translate-x-1/2">
                <span className="bg-teal-400 text-teal-900 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wide">
                  Most popular
                </span>
              </div>
              <div className="mb-6">
                <p className="text-xs font-semibold text-teal-200 uppercase tracking-wider mb-2">Professional</p>
                <div className="flex items-end gap-1 mb-3">
                  <span className="text-4xl font-bold">$39</span>
                  <span className="text-teal-200 mb-1">/month</span>
                </div>
                <p className="text-sm text-teal-100">Full Intelligence Brief access.</p>
              </div>
              <a
                href={`${APP_URL}/register?plan=professional`}
                className="block w-full text-center py-2.5 px-5 rounded-lg bg-white text-teal-700 text-sm font-semibold hover:bg-teal-50 transition-colors mb-8"
              >
                Subscribe now
              </a>
              <ul className="space-y-3 text-sm text-teal-100">
                {[
                  "Full weekly Intelligence Brief",
                  "All signal categories",
                  "Risk-scored findings",
                  "Recommended actions per finding",
                  "Executive synthesis",
                  "Searchable brief archive",
                  "Email delivery",
                ].map((f) => (
                  <li key={f} className="flex items-start gap-2.5">
                    <span className="mt-0.5 w-4 h-4 rounded-full bg-teal-500 text-white flex items-center justify-center flex-shrink-0">
                      <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    {f}
                  </li>
                ))}
              </ul>
            </div>

            {/* Enterprise */}
            <div className="bg-slate-900 rounded-2xl p-8 text-white shadow-sm">
              <div className="mb-6">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Enterprise</p>
                <div className="flex items-end gap-1 mb-3">
                  <span className="text-4xl font-bold">Custom</span>
                </div>
                <p className="text-sm text-slate-400">Full platform, API, and dedicated support.</p>
              </div>
              <a
                href="mailto:hello@securelogicai.com"
                className="block w-full text-center py-2.5 px-5 rounded-lg border border-slate-600 text-slate-200 text-sm font-semibold hover:border-slate-400 transition-colors mb-8"
              >
                Contact us
              </a>
              <ul className="space-y-3 text-sm text-slate-400">
                {[
                  "Everything in Professional",
                  "Vendor Risk module (when available)",
                  "AI Governance module (when available)",
                  "Compliance module (when available)",
                  "API access to risk intelligence",
                  "Multi-user organization accounts",
                  "Dedicated onboarding",
                  "SLA and enterprise support",
                ].map((f) => (
                  <li key={f} className="flex items-start gap-2.5">
                    <span className="mt-0.5 w-4 h-4 rounded-full bg-slate-700 text-slate-300 flex items-center justify-center flex-shrink-0">
                      <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-slate-50 border-t border-slate-200 py-20 px-4">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold text-slate-900 mb-10 text-center">Common questions</h2>
          <div className="space-y-8">
            {[
              {
                q: "When is the Intelligence Brief delivered?",
                a: "The Intelligence Brief is generated and delivered weekly. Subscribers receive it by email and can also access it via the platform.",
              },
              {
                q: "What sources does the Intelligence Brief cover?",
                a: "The brief draws from security advisories, regulatory publications, vendor risk feeds (SecurityWeek, Dark Reading), AI governance sources, and additional threat intelligence channels.",
              },
              {
                q: "Can I cancel my subscription?",
                a: "Yes. Cancel at any time. Your access continues through the end of the billing period.",
              },
              {
                q: "When will the full platform (Vendor Risk, AI Governance, Compliance) be available?",
                a: "These modules are in active development. Enterprise customers get early access. Contact us for a roadmap conversation.",
              },
              {
                q: "Is there an API for risk intelligence data?",
                a: "Yes, as part of the Enterprise tier. Contact us to discuss your integration requirements.",
              },
            ].map((item) => (
              <div key={item.q} className="border-b border-slate-200 pb-8">
                <h3 className="font-semibold text-slate-900 mb-2">{item.q}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{item.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="py-20 px-4 text-center">
        <div className="max-w-xl mx-auto">
          <h2 className="text-2xl font-bold text-slate-900 mb-3">Ready to get started?</h2>
          <p className="text-slate-500 mb-7 text-sm">
            Free access available immediately. No credit card required.
          </p>
          <a
            href={`${APP_URL}/register`}
            className="inline-flex items-center px-7 py-3 rounded-lg bg-teal-600 text-white font-semibold hover:bg-teal-700 transition-colors"
          >
            Create free account
          </a>
        </div>
      </section>
    </>
  );
}
