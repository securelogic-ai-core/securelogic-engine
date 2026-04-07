import Link from "next/link";

const VALUE_PROPS = [
  {
    icon: "🔍",
    title: "Threat Signal Analysis",
    description:
      "Curated security developments scored by impact, novelty, and relevance to your risk profile.",
  },
  {
    icon: "📋",
    title: "Compliance Risk Monitoring",
    description:
      "Regulatory updates across SOC 2, NIST, ISO, and emerging frameworks — translated into actionable context.",
  },
  {
    icon: "🤖",
    title: "AI Governance Developments",
    description:
      "Policy shifts, model risk events, and governance signals distilled for risk and compliance leaders.",
  },
  {
    icon: "🏢",
    title: "Vendor & Third-Party Risk",
    description:
      "Supply chain incidents, vendor breaches, and third-party risk intelligence in one place.",
  },
];

const HOW_IT_WORKS = [
  {
    step: "01",
    title: "Register",
    description:
      "Create a free account in seconds. No credit card required. You get immediate access to the brief archive.",
  },
  {
    step: "02",
    title: "Get the weekly brief",
    description:
      "Every week, the SecureLogic Intelligence Engine processes hundreds of signals and distills them into a decision-ready brief.",
  },
  {
    step: "03",
    title: "Upgrade for full access",
    description:
      "Subscribe to unlock complete brief content, all sections, and the full archive — built for teams that need depth.",
  },
];

export default function LandingPage() {
  return (
    <div>
      {/* Hero */}
      <section className="bg-slate-900 text-white">
        <div className="max-w-4xl mx-auto px-6 py-24 text-center">
          <div className="inline-flex items-center gap-2 bg-indigo-900/50 border border-indigo-700 text-indigo-300 text-xs font-medium px-3 py-1 rounded-full mb-8">
            <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full" />
            Intelligence Brief — Weekly
          </div>

          <h1 className="text-4xl sm:text-5xl font-bold leading-tight mb-6">
            Risk intelligence your team
            <br />
            <span className="text-indigo-400">can act on.</span>
          </h1>

          <p className="text-slate-400 text-lg leading-relaxed max-w-2xl mx-auto mb-10">
            The SecureLogic Intelligence Brief delivers weekly, decision-ready risk
            intelligence across security threats, compliance developments, AI governance,
            and vendor risk — curated for leaders who need signal, not noise.
          </p>

          <div className="flex items-center justify-center gap-4">
            <Link
              href="/register"
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-8 py-3 rounded-lg transition-colors"
            >
              Get Started Free
            </Link>
            <Link
              href="/login"
              className="text-slate-400 hover:text-white font-medium px-6 py-3 rounded-lg border border-slate-700 hover:border-slate-600 transition-colors"
            >
              Sign In
            </Link>
          </div>
        </div>
      </section>

      {/* Value props */}
      <section className="max-w-6xl mx-auto px-6 py-20">
        <div className="text-center mb-12">
          <h2 className="text-2xl font-bold text-slate-900 mb-3">
            One brief. Four domains. Zero noise.
          </h2>
          <p className="text-slate-600 max-w-xl mx-auto">
            Each issue is processed through the SecureLogic Engine — scoring every
            signal for impact, novelty, and relevance before it reaches your inbox.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          {VALUE_PROPS.map((prop) => (
            <div
              key={prop.title}
              className="bg-white border border-slate-200 rounded-lg p-6"
            >
              <div className="text-2xl mb-3">{prop.icon}</div>
              <h3 className="font-semibold text-slate-900 mb-2">{prop.title}</h3>
              <p className="text-slate-600 text-sm leading-relaxed">
                {prop.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="bg-slate-900 text-white">
        <div className="max-w-4xl mx-auto px-6 py-20">
          <h2 className="text-2xl font-bold text-center mb-12">How it works</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-10">
            {HOW_IT_WORKS.map((item) => (
              <div key={item.step}>
                <div className="text-indigo-400 font-mono text-sm font-bold mb-3">
                  {item.step}
                </div>
                <h3 className="font-semibold text-white mb-2">{item.title}</h3>
                <p className="text-slate-400 text-sm leading-relaxed">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="max-w-6xl mx-auto px-6 py-20">
        <div className="text-center mb-12">
          <h2 className="text-2xl font-bold text-slate-900 mb-3">Simple pricing</h2>
          <p className="text-slate-600">
            Start free. Upgrade when you need full depth.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {/* Free */}
          <div className="bg-white border border-slate-200 rounded-lg p-7 flex flex-col">
            <div className="mb-6">
              <h3 className="font-bold text-slate-900 text-lg mb-1">Free</h3>
              <div className="text-3xl font-bold text-slate-900">
                $0
                <span className="text-slate-400 text-base font-normal"> / mo</span>
              </div>
            </div>
            <ul className="space-y-2.5 mb-8 flex-1">
              {[
                "Brief archive access",
                "Issue titles and summaries",
                "Weekly email digest",
              ].map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-slate-700">
                  <CheckIcon />
                  {f}
                </li>
              ))}
            </ul>
            <Link
              href="/register"
              className="block text-center bg-slate-900 hover:bg-slate-800 text-white font-medium py-2.5 rounded-lg transition-colors text-sm"
            >
              Get Started
            </Link>
          </div>

          {/* Professional */}
          <div className="bg-white border border-slate-200 rounded-lg p-7 flex flex-col">
            <div className="mb-6">
              <h3 className="font-bold text-slate-900 text-lg mb-1">Professional</h3>
              <div className="text-3xl font-bold text-slate-900">
                $49
                <span className="text-slate-400 text-base font-normal"> / mo</span>
              </div>
            </div>
            <ul className="space-y-2.5 mb-8 flex-1">
              {[
                "Everything in Free",
                "Full brief content",
                "All sections unlocked",
                "Complete archive",
              ].map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-slate-700">
                  <CheckIcon />
                  {f}
                </li>
              ))}
            </ul>
            <Link
              href="/register?plan=professional"
              className="block text-center border border-indigo-600 text-indigo-600 hover:bg-indigo-50 font-medium py-2.5 rounded-lg transition-colors text-sm"
            >
              Get Started
            </Link>
          </div>

          {/* Team */}
          <div className="bg-indigo-600 rounded-lg p-7 text-white relative overflow-hidden flex flex-col">
            <div className="absolute top-4 right-4 bg-indigo-500 text-indigo-100 text-xs font-semibold px-2 py-0.5 rounded">
              Most Popular
            </div>
            <div className="mb-6">
              <h3 className="font-bold text-lg mb-1">Team</h3>
              <div className="text-3xl font-bold">
                $249
                <span className="text-indigo-300 text-base font-normal"> / mo</span>
              </div>
            </div>
            <ul className="space-y-2.5 mb-8 flex-1">
              {[
                "Everything in Professional",
                "Up to 10 seats",
                "Priority support",
                "Early access to new modules",
              ].map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-indigo-100">
                  <CheckIconWhite />
                  {f}
                </li>
              ))}
            </ul>
            <Link
              href="/register?plan=team"
              className="block text-center bg-white text-indigo-700 hover:bg-indigo-50 font-medium py-2.5 rounded-lg transition-colors text-sm"
            >
              Get Started
            </Link>
          </div>

          {/* Enterprise */}
          <div className="bg-slate-900 rounded-lg p-7 text-white flex flex-col">
            <div className="mb-6">
              <h3 className="font-bold text-lg mb-1">Enterprise</h3>
              <div className="text-3xl font-bold">
                Custom
              </div>
            </div>
            <ul className="space-y-2.5 mb-8 flex-1">
              {[
                "Everything in Team",
                "Unlimited seats",
                "Custom SLA",
                "Dedicated onboarding",
                "Invoice billing",
              ].map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-slate-300">
                  <CheckIconWhite />
                  {f}
                </li>
              ))}
            </ul>
            <a
              href="mailto:sales@securelogic.ai"
              className="block text-center border border-slate-600 hover:border-slate-400 text-slate-300 hover:text-white font-medium py-2.5 rounded-lg transition-colors text-sm"
            >
              Contact Us
            </a>
          </div>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="border-t border-slate-200 bg-white">
        <div className="max-w-3xl mx-auto px-6 py-16 text-center">
          <h2 className="text-2xl font-bold text-slate-900 mb-4">
            Ready to cut through the noise?
          </h2>
          <p className="text-slate-600 mb-8">
            Join security and risk leaders receiving the SecureLogic Intelligence Brief.
          </p>
          <Link
            href="/register"
            className="inline-block bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-10 py-3 rounded-lg transition-colors"
          >
            Create Free Account
          </Link>
        </div>
      </section>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg className="w-4 h-4 text-indigo-600 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}

function CheckIconWhite() {
  return (
    <svg className="w-4 h-4 text-indigo-200 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}
