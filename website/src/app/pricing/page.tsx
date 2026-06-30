import type { Metadata } from "next";
import { Fragment } from "react";
import Link from "next/link";
import { PricingCards } from "@/components/PricingCards";
import { getPricingTiers } from "@/lib/pricing";

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
const TIERS = getPricingTiers(APP_URL);

// Renders one comparison-matrix cell: check / dash / specific allowance text.
function MatrixValue({ value }: { value: boolean | string }) {
  if (value === true) {
    return (
      <span className="inline-flex text-accent" role="img" aria-label="Included">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
      </span>
    );
  }
  if (value === false) {
    return (
      <span className="text-text-muted/40" role="img" aria-label="Not included">
        —
      </span>
    );
  }
  return <span className="text-xs text-text-body">{value}</span>;
}

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
  "Team Professional includes up to 6 seats.",
  "Need more than 6 seats on the brief? Move to Platform.",
  "Platform Professional includes up to 10 seats / 50 monitored entities.",
  "Need more than 10 seats or 50 entities, white-labeling, SSO/SAML, or multi-org? Talk to us about Enterprise.",
  "Founding annual rate available through Dec 2026.",
  "Annual founding customers keep their rate for as long as the subscription remains active.",
  "Month-to-month available at $800/month.",
];

// ── Full feature comparison matrix ─────────────────────────────────────
// Columns follow the five-tier order from the shared pricing model. Values:
//   true → included · false → not included · string → specific allowance.
type Cell = boolean | string;
interface MatrixRow {
  label: string;
  cells: [Cell, Cell, Cell, Cell, Cell]; // Free · Brief Pro · Team · Platform · Enterprise
}
interface MatrixGroup {
  group: string;
  rows: MatrixRow[];
}

const COMPARISON_MATRIX: MatrixGroup[] = [
  {
    group: "Intelligence Brief",
    rows: [
      { label: "Weekly Intelligence Brief", cells: ["Top signals", true, true, true, true] },
      { label: "Full brief — all signals every week", cells: [false, true, true, true, true] },
      { label: "Why It Matters + Recommended Actions", cells: [false, true, true, true, true] },
      { label: "Personalized to your vendors & AI systems", cells: [false, true, true, true, true] },
      { label: "Brief archive & search", cells: [false, true, true, true, true] },
      { label: "Severity filtering", cells: [false, true, true, true, true] },
      { label: "Seats included", cells: ["1", "1", "Up to 6", "Up to 10", "Custom"] },
    ],
  },
  {
    group: "Risk platform",
    rows: [
      { label: "Vendor risk management", cells: [false, false, false, true, true] },
      { label: "AI governance assessments", cells: [false, false, false, true, true] },
      { label: "Compliance frameworks (SOC 2, ISO 27001, NIST CSF…)", cells: [false, false, false, true, true] },
      { label: "Risk register with treatment workflows", cells: [false, false, false, true, true] },
      { label: "Posture scoring across 4 domains", cells: [false, false, false, true, true] },
      { label: "Leadership intelligence dashboard", cells: [false, false, false, true, true] },
      { label: "API access + audit log", cells: [false, false, false, true, true] },
      { label: "Monitored entities", cells: ["—", "—", "—", "Up to 50", "Custom"] },
    ],
  },
  {
    group: "Enterprise & procurement",
    rows: [
      { label: "SSO / SAML", cells: [false, false, false, false, true] },
      { label: "White-labeled Intelligence Brief", cells: [false, false, false, false, true] },
      { label: "Multi-org support (MSSP)", cells: [false, false, false, false, true] },
      { label: "Custom data retention", cells: [false, false, false, false, true] },
      { label: "Dedicated onboarding + SLA", cells: [false, false, false, false, true] },
      { label: "Invoicing & purchase orders", cells: [false, false, false, "Annual plans", true] },
    ],
  },
];

// ── Billing & procurement explainer cards ──────────────────────────────
const PROCUREMENT = [
  {
    title: "Annual vs monthly",
    body: "Platform Professional is offered as a founding annual plan and as month-to-month. Annual locks the founding rate for as long as the subscription stays active; month-to-month bills each month and can change to annual any time before December 31, 2026 to qualify for the founding rate.",
  },
  {
    title: "Seats & monitored entities",
    body: "Team Professional includes up to 6 seats; Platform Professional includes up to 10 seats and 50 monitored entities (vendors and AI systems). Need more seats or entities, multi-org, or white-labeling? That's Enterprise.",
  },
  {
    title: "Proration",
    body: "Upgrades take effect immediately and are prorated for the remainder of the current billing period, so you only pay the difference. Team Professional spend is credited toward Platform when you upgrade.",
  },
  {
    title: "Purchase orders & invoicing",
    body: "Annual Platform Professional and Enterprise plans support payment by invoice and purchase order, with net terms available for Enterprise. Monthly plans are billed by card. Contact us to set up a PO or request an invoice.",
  },
  {
    title: "Enterprise purchasing",
    body: "Enterprise agreements cover custom seats and entities, SSO/SAML, multi-org, custom data retention, security review support (questionnaires, DPA), and a dedicated onboarding plan with an SLA.",
  },
  {
    title: "Support & onboarding",
    body: "All paid plans include onboarding guidance; Platform Professional and Enterprise add structured onboarding. Enterprise includes priority support and a named point of contact.",
  },
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
    a: "Absolutely — that's the intended path. Start free, move to Brief Pro or Team Professional, then upgrade to the Platform when you're ready. Team Professional spend is credited toward Platform when you upgrade.",
  },
  {
    q: "Can we pay by invoice or purchase order?",
    a: "Yes. Annual Platform Professional and Enterprise plans support payment by invoice and purchase order, with net terms available for Enterprise. Monthly subscriptions are billed by card. Contact us and we'll set up a PO or send an invoice.",
  },
  {
    q: "How does proration work when we upgrade?",
    a: "Upgrades take effect immediately and are prorated for the remainder of the current billing period — you only pay the difference. Team Professional spend is credited toward Platform when you move up.",
  },
  {
    q: "What do you need for our security and procurement review?",
    a: "For due diligence we provide a Security Overview, our subprocessor list, and our privacy and AI policies via the Trust Center. Enterprise engagements include support for security questionnaires and a Data Processing Addendum (DPA). Reach out and we'll route your review.",
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

      {/* ─── C2. Full plan comparison matrix ─────────────────────────────── */}
      <section className="bg-bg border-t border-hairline">
        <div className="container-site py-20 lg:py-[100px]">
          <div className="max-w-2xl mb-10">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-text leading-tight mb-4">
              Compare every plan
            </h2>
            <p className="text-text-muted leading-relaxed">
              From the free weekly brief to the full enterprise platform — exactly what&apos;s
              included at each tier.
            </p>
          </div>
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] border-collapse text-left">
                <caption className="sr-only">
                  Feature comparison across all SecureLogic AI plans
                </caption>
                <thead>
                  <tr className="bg-bg-elevated-2">
                    <th scope="col" className="w-[32%] px-4 py-4 align-bottom">
                      <span className="pill-mono text-text-muted">Features</span>
                    </th>
                    {TIERS.map((t) => (
                      <th
                        key={t.id}
                        scope="col"
                        className="px-4 py-4 align-bottom border-l border-hairline"
                      >
                        <span className="block text-text font-bold text-sm leading-tight">{t.name}</span>
                        <span className="block text-text-muted text-xs mt-1">
                          {t.price}
                          {t.priceNote ? ` ${t.priceNote}` : ""}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON_MATRIX.map((g) => (
                    <Fragment key={g.group}>
                      <tr className="bg-bg-elevated">
                        <th scope="colgroup" colSpan={6} className="px-4 pt-6 pb-3 text-left">
                          <span className="eyebrow">{g.group}</span>
                        </th>
                      </tr>
                      {g.rows.map((row) => (
                        <tr key={row.label} className="border-t border-hairline align-top">
                          <th scope="row" className="px-4 py-3 text-sm text-text-body font-normal">
                            {row.label}
                          </th>
                          {row.cells.map((c, idx) => (
                            <td
                              key={idx}
                              className="px-4 py-3 border-l border-hairline text-center"
                            >
                              <MatrixValue value={c} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="text-xs text-text-muted mt-4">
            Founding rates shown apply through December 2026. Scroll horizontally to see every plan.
          </p>
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
                  <Link href={`${APP_URL}/signup?plan=platform_annual`} className="btn-primary">
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

      {/* ─── E2. Billing & procurement ───────────────────────────────────── */}
      <section className="bg-bg border-t border-hairline">
        <div className="container-site py-20 lg:py-[100px]">
          <div className="max-w-2xl mb-12">
            <p className="eyebrow mb-4">Billing &amp; procurement</p>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-text leading-tight mb-4">
              Built for how enterprises actually buy.
            </h2>
            <p className="text-text-muted leading-relaxed">
              Purchase orders, invoicing, proration, seats, and security review — the answers
              procurement needs before signing.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {PROCUREMENT.map((p) => (
              <div key={p.title} className="card p-7">
                <h3 className="text-text font-bold text-base mb-2">{p.title}</h3>
                <p className="text-sm text-text-muted leading-relaxed">{p.body}</p>
              </div>
            ))}
          </div>
          <div className="card bg-bg-elevated-2 border-accent/30 p-7 mt-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-5">
            <div>
              <h3 className="text-text font-bold text-lg mb-1">Need a quote, PO, or security review?</h3>
              <p className="text-sm text-text-muted leading-relaxed max-w-xl">
                Tell us your seats, entities, and procurement requirements and we&apos;ll prepare a
                quote and the documents your review needs.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 flex-shrink-0">
              <Link href="/contact/" className="btn-primary">Contact Sales</Link>
              <Link href="/trust/" className="btn-outline">Trust Center</Link>
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
            <Link href={`${APP_URL}/signup?plan=platform_annual`} className="btn-outline">Start Free Trial</Link>
            <Link href="/contact/" className="btn-outline">Talk to Sales</Link>
          </div>
        </div>
      </section>
    </>
  );
}
