import Link from "next/link";

const PLANS = [
  {
    name: "Free",
    price: "$0",
    period: "/ mo",
    description: "Access the brief archive and stay informed on key risk developments.",
    features: [
      "Brief archive access",
      "Issue titles and summaries",
      "Weekly Intelligence Brief",
    ],
    cta: "Get Started",
    href: "/signup",
    style: "default" as const,
  },
  {
    name: "Brief Pro",
    price: "$49",
    period: "/ mo",
    description: "Full brief content for the individual practitioner who needs depth.",
    features: [
      "Everything in Free",
      "Full brief content",
      "All sections unlocked",
      "Complete archive",
    ],
    cta: "Get Started",
    href: "/signup?plan=professional",
    style: "outline" as const,
  },
  {
    name: "Team Professional",
    price: "$199",
    period: "/ mo",
    description: "For security and risk teams that need shared access and priority support.",
    features: [
      "Everything in Brief Pro",
      "Up to 6 seats",
      "Priority support",
      "Early access to new modules",
    ],
    cta: "Get Started",
    href: "/signup?plan=teams",
    style: "primary" as const,
    badge: "Most Popular",
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "",
    description: "Tailored for large organizations with compliance, procurement, and SLA requirements.",
    features: [
      "Everything in Team Professional",
      "Unlimited seats",
      "Custom SLA",
      "Dedicated onboarding",
      "Invoice billing",
    ],
    cta: "Contact Us",
    href: "mailto:sales@securelogicai.com",
    style: "dark" as const,
  },
];

export default function PricingPage() {
  return (
    <div className="max-w-6xl mx-auto px-6 py-20">
      <div className="text-center mb-14">
        <h1 className="text-3xl font-bold text-slate-900 mb-4">
          Intelligence Brief — Pricing
        </h1>
        <p className="text-slate-600 max-w-xl mx-auto">
          Start free. Upgrade when you need full depth, full access, or team-wide coverage.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-16">
        {PLANS.map((plan) => (
          <PlanCard key={plan.name} plan={plan} />
        ))}
      </div>

      {/* FAQ / notes */}
      <div className="max-w-2xl mx-auto border-t border-slate-200 pt-12">
        <h2 className="text-lg font-bold text-slate-900 mb-6 text-center">
          Common questions
        </h2>
        <dl className="space-y-6">
          {[
            {
              q: "What is the Intelligence Brief?",
              a: "A weekly, decision-ready risk intelligence report processed by the SecureLogic Engine — covering security threats, compliance developments, AI governance, and vendor risk.",
            },
            {
              q: "Can I cancel at any time?",
              a: "Yes. Paid subscriptions can be cancelled at any time from your account page. Your access remains active through the end of your billing period.",
            },
            {
              q: "What counts as a seat on the Team plan?",
              a: "Each registered organization account counts as one seat. Team accounts can have up to 6 users sharing access to the Intelligence Brief.",
            },
            {
              q: "What is included in Enterprise?",
              a: "Enterprise plans include custom pricing, dedicated onboarding, a committed SLA, invoice billing, and early access to platform modules. Contact us to discuss requirements.",
            },
          ].map(({ q, a }) => (
            <div key={q}>
              <dt className="font-semibold text-slate-900 mb-1">{q}</dt>
              <dd className="text-slate-600 text-sm leading-relaxed">{a}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

type PlanStyle = "default" | "outline" | "primary" | "dark";

function PlanCard({
  plan,
}: {
  plan: {
    name: string;
    price: string;
    period: string;
    description: string;
    features: string[];
    cta: string;
    href: string;
    style: PlanStyle;
    badge?: string;
  };
}) {
  const isPrimary = plan.style === "primary";
  const isDark = plan.style === "dark";

  const cardClass = isPrimary
    ? "bg-teal-600 text-white rounded-xl p-7 flex flex-col relative overflow-hidden"
    : isDark
    ? "bg-navy-900 text-white rounded-xl p-7 flex flex-col"
    : "bg-white border border-slate-200 rounded-xl shadow-sm p-7 flex flex-col";

  const priceClass = isPrimary || isDark ? "text-white" : "text-slate-900";
  const periodClass = isPrimary ? "text-teal-300" : isDark ? "text-slate-400" : "text-slate-400";
  const featureClass = isPrimary ? "text-teal-100" : isDark ? "text-slate-300" : "text-slate-700";
  const descClass = isPrimary ? "text-teal-200" : isDark ? "text-slate-400" : "text-slate-500";

  const ctaClass =
    isPrimary
      ? "block text-center bg-white text-teal-700 hover:bg-teal-50 font-medium py-2.5 rounded-lg transition-colors text-sm"
      : isDark
      ? "block text-center border border-slate-600 hover:border-slate-400 text-slate-300 hover:text-white font-medium py-2.5 rounded-lg transition-colors text-sm"
      : plan.style === "outline"
      ? "block text-center border border-teal-600 text-teal-600 hover:bg-teal-50 font-medium py-2.5 rounded-lg transition-colors text-sm"
      : "block text-center bg-slate-900 hover:bg-slate-800 text-white font-medium py-2.5 rounded-lg transition-colors text-sm";

  return (
    <div className={cardClass}>
      {plan.badge && (
        <div className="absolute top-4 right-4 bg-teal-500 text-teal-100 text-xs font-semibold px-2 py-0.5 rounded">
          {plan.badge}
        </div>
      )}

      <div className="mb-4">
        <h3 className={`font-bold text-lg mb-1 ${isPrimary || isDark ? "text-white" : "text-slate-900"}`}>
          {plan.name}
        </h3>
        <div className={`text-3xl font-bold ${priceClass}`}>
          {plan.price}
          {plan.period && (
            <span className={`text-base font-normal ${periodClass}`}> {plan.period}</span>
          )}
        </div>
      </div>

      <p className={`text-sm mb-6 leading-relaxed ${descClass}`}>{plan.description}</p>

      <ul className="space-y-2.5 mb-8 flex-1">
        {plan.features.map((f) => (
          <li key={f} className={`flex items-start gap-2 text-sm ${featureClass}`}>
            {isPrimary || isDark ? <CheckIconWhite /> : <CheckIcon />}
            {f}
          </li>
        ))}
      </ul>

      <Link href={plan.href} className={ctaClass}>
        {plan.cta}
      </Link>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg
      className="w-4 h-4 text-teal-600 flex-shrink-0 mt-0.5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2.5}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}

function CheckIconWhite() {
  return (
    <svg
      className="w-4 h-4 text-teal-200 flex-shrink-0 mt-0.5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2.5}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}
