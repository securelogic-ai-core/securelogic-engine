import type { Metadata } from "next";
import Link from "next/link";
import { PricingCards } from "@/components/PricingCards";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Compare SecureLogic AI plans for weekly intelligence, personalized briefing, team briefing, platform workflows, and enterprise requirements.",
  openGraph: {
    title: "Pricing — SecureLogic AI",
    description:
      "Compare SecureLogic AI plans for weekly intelligence, personalized briefing, team briefing, platform workflows, and enterprise requirements.",
  },
};

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.securelogicai.com";

// ── C. Free vs Brief Pro comparison rows ───────────────────────────────
const COMPARISON: { free: string; pro: string }[] = [
  { free: "Top 3 signals only", pro: "All signals" },
  { free: "No recommended actions", pro: "Recommended Actions on every item" },
  { free: "General coverage", pro: "Personalized to your registered vendors & risks" },
  { free: "No org context", pro: "Relevant-to-your-org flags" },
  { free: "No archive access", pro: "Full searchable archive" },
  { free: "Standard delivery", pro: "Priority delivery every Monday" },
  { free: "Email only", pro: "Severity filtering" },
];

const PLATFORM_HIGHLIGHTS = [
  "Vendor risk management",
  "AI governance assessments",
  "Compliance frameworks",
  "Cyber intelligence",
  "Posture scoring across 4 domains",
  "Leadership intelligence dashboard",
  "API access + audit log",
];

const DETAILS = [
  "Brief-Team includes up to 6 seats.",
  "Need more than 6 seats on the brief? Move to Platform.",
  "Platform Professional includes up to 10 seats / 50 monitored entities.",
  "Need more than 10 seats or 50 entities, white-labeling, SSO/SAML, or multi-org? Talk to us about Enterprise.",
  "Founding annual rate available through Dec 2026.",
  "Annual founding customers keep their rate for as long as the subscription remains active.",
  "Month-to-month available at $800/month.",
];

const FAQ = [
  {
    q: "What's the difference between Free and Brief Pro?",
    a: "Free delivers the top signals each week with executive summary and analyst commentary. Brief Pro unlocks every signal, adds Why It Matters and Recommended Actions to each item, and personalizes the brief to your registered vendors, AI systems, and obligations — plus a searchable archive, severity filtering, and priority delivery.",
  },
  {
    q: "Is Platform Professional a separate product?",
    a: "Platform Professional is a different product class from the Brief. The three Brief tiers are a weekly briefing; Platform Professional is the full risk platform — vendor risk, AI governance, compliance, risk register, posture scoring, and a leadership dashboard — with Brief Pro included.",
  },
  {
    q: "Do I need a credit card for the trial?",
    a: "No. The free Intelligence Brief never requires a card, and you can start a Platform Professional trial without entering payment details up front.",
  },
  {
    q: "Do you support enterprise requirements like SSO and white-labeling?",
    a: "Yes. Enterprise adds SSO / SAML, custom signal sources, a white-labeled Intelligence Brief, multi-org support for MSSPs, custom data retention, and dedicated onboarding with an SLA. Talk to Sales to scope a plan.",
  },
  {
    q: "Can I start with the brief and upgrade later?",
    a: "Absolutely — that's the intended path. Start free, move to Brief Pro or Brief-Team, then upgrade to the Platform when you're ready. Brief-Team spend is credited toward Platform when you upgrade.",
  },
];

export default function PricingPage() {
  return (
    <>
      {/* ─── A. Hero ─────────────────────────────────────────────────────── */}
      <section className="bg-bg text-text border-b border-hairline">
        <div className="container-site py-20 lg:py-24">
          <div className="max-w-3xl">
            <p className="eyebrow mb-4">Pricing</p>
            <h1 className="text-[2.5rem] sm:text-5xl font-extrabold leading-[1.07] tracking-tight mb-6">
              Simple, transparent pricing for intelligence and platform workflows.
            </h1>
            <p className="text-lg text-text-body leading-relaxed">
              Start with the weekly brief. Upgrade when you need personalized intelligence,
              team distribution, platform workflows, and enterprise controls.
            </p>
          </div>
        </div>
      </section>

      {/* ─── B. Pricing cards ────────────────────────────────────────────── */}
      <section className="bg-bg">
        <div className="container-site py-16 lg:py-20">
          <PricingCards appUrl={APP_URL} />
        </div>
      </section>

      {/* ─── C. Free vs Brief Pro comparison ─────────────────────────────── */}
      <section className="bg-bg-elevated border-t border-hairline">
        <div className="container-site py-20 lg:py-[100px]">
          <h2 className="text-3xl sm:text-4xl font-extrabold text-text leading-tight mb-10">
            Free vs Brief Pro
          </h2>
          <div className="card overflow-hidden">
            <div className="grid grid-cols-[1fr_1fr] sm:grid-cols-[1fr_1fr] divide-x divide-hairline">
              <div className="px-5 py-4 bg-bg">
                <p className="pill-mono text-text-muted">Free</p>
              </div>
              <div className="px-5 py-4 bg-bg-elevated-2">
                <p className="pill-mono text-accent">Brief Pro · $49/mo</p>
              </div>
            </div>
            <ul>
              {COMPARISON.map((row) => (
                <li key={row.pro} className="grid grid-cols-2 divide-x divide-hairline border-t border-hairline">
                  <span className="px-5 py-4 text-sm text-text-muted">{row.free}</span>
                  <span className="px-5 py-4 text-sm text-text-body flex items-start gap-2.5">
                    <svg className="w-4 h-4 mt-0.5 flex-shrink-0 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                    {row.pro}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ─── D. Platform Professional premium detail ─────────────────────── */}
      <section className="bg-bg">
        <div className="container-site py-20 lg:py-[100px]">
          <div className="card bg-bg-elevated-2 border-accent/40 ring-1 ring-accent/20 p-8 sm:p-10">
            <div className="grid lg:grid-cols-[1.1fr_1fr] gap-10 items-center">
              <div>
                <p className="eyebrow mb-4">Platform Professional</p>
                <h2 className="text-3xl sm:text-4xl font-extrabold text-text leading-tight mb-4">
                  The full risk platform, in one operating picture.
                </h2>
                <p className="text-text-body leading-relaxed mb-2">
                  Founding rate · through Dec 2026 — <span className="text-text font-semibold">$600/month billed annually</span>{" "}
                  ($7,200/year total), or $800 month-to-month.
                </p>
                <p className="text-sm text-text-muted">
                  Locked in for as long as you remain an active customer.
                </p>
                <div className="mt-6">
                  <Link href={`${APP_URL}/signup?plan=professional`} className="btn-primary">
                    Start Free Trial
                  </Link>
                </div>
              </div>
              <ul className="grid sm:grid-cols-2 gap-3">
                {PLATFORM_HIGHLIGHTS.map((h) => (
                  <li key={h} className="flex items-start gap-2.5 text-sm text-text-body">
                    <span className="mt-0.5 flex-shrink-0 w-4 h-4 rounded-full bg-accent/15 text-accent flex items-center justify-center">
                      <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    {h}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ─── E. Pricing details ──────────────────────────────────────────── */}
      <section className="bg-bg-elevated border-t border-hairline">
        <div className="container-site py-20 lg:py-[100px]">
          <div className="max-w-3xl">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-text leading-tight mb-8">
              Pricing details
            </h2>
            <ul className="space-y-3 mb-10">
              {DETAILS.map((d) => (
                <li key={d} className="flex items-start gap-3 text-text-body">
                  <span className="mt-2 w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0" />
                  <span className="leading-relaxed">{d}</span>
                </li>
              ))}
            </ul>
            <div className="card p-6 space-y-3 text-sm text-text-muted leading-relaxed">
              <p>
                Customers who start on the founding annual plan in 2026 keep that rate
                for as long as the subscription remains active. If the subscription is
                canceled or lapses, they return at then-current pricing.
              </p>
              <p>
                If a customer starts monthly and converts to annual before December 31,
                2026, they qualify for founding annual pricing.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ─── F. FAQ ──────────────────────────────────────────────────────── */}
      <section className="bg-bg">
        <div className="container-site py-20 lg:py-[100px]">
          <h2 className="text-3xl sm:text-4xl font-extrabold text-text leading-tight mb-10">
            Frequently asked questions
          </h2>
          <div className="max-w-3xl divide-y divide-hairline">
            {FAQ.map((item) => (
              <div key={item.q} className="py-6">
                <h3 className="text-text font-bold text-lg mb-2">{item.q}</h3>
                <p className="text-sm text-text-muted leading-relaxed">{item.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── G. Bottom CTA ───────────────────────────────────────────────── */}
      <section className="bg-bg-elevated border-t border-hairline">
        <div className="container-site py-16 text-center">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-text mb-6">
            Start with the brief. Stay for the platform.
          </h2>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/#brief-signup" className="btn-primary">Get the Free Brief</Link>
            <Link href={`${APP_URL}/signup?plan=professional`} className="btn-outline">Start Free Trial</Link>
            <Link href="/contact/" className="btn-outline">Talk to Sales</Link>
          </div>
        </div>
      </section>
    </>
  );
}
