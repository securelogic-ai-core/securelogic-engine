import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "About",
  description:
    "Learn why SecureLogic AI exists and how it helps security teams turn cyber and regulatory noise into clear, prioritized action.",
  openGraph: {
    title: "About — SecureLogic AI",
    description:
      "Learn why SecureLogic AI exists and how it helps security teams turn cyber and regulatory noise into clear, prioritized action.",
  },
};

const WHAT_WE_DO = [
  { title: "Monitor signals", copy: "Continuously watch cyber, vendor, AI, and regulatory sources for what changes." },
  { title: "Match them to your stack", copy: "Connect each signal to your vendors, AI systems, controls, and obligations." },
  { title: "Prioritize what matters", copy: "Score and rank by real exposure so the urgent rises above the noise." },
  { title: "Drive action through the platform", copy: "Turn intelligence into recommended actions, treatments, and reporting." },
];

const AUDIENCES = [
  { title: "Lean security teams", copy: "Small teams carrying enterprise obligations who can't read every feed by hand." },
  { title: "GRC / compliance leaders", copy: "Owners of obligations and assessments who need posture they can report on." },
  { title: "Teams managing growing vendor and AI risk", copy: "Organizations whose third-party and AI footprint is expanding faster than headcount." },
];

const BELIEFS = [
  { title: "Intelligence is only useful if it's connected", copy: "A signal means nothing until it's tied to a vendor, control, or obligation you actually own." },
  { title: "The job isn't to alert — it's to decide", copy: "Teams don't need more notifications. They need a clear next action and the context to back it." },
  { title: "Lean teams deserve enterprise reach", copy: "The same coverage a large security org expects, sized for the teams doing the work today." },
];

const PRINCIPLES = [
  "Built for operational clarity, not feed volume.",
  "Designed for small teams with enterprise obligations.",
  "Focused on actionability over generic alerting.",
  "Aligned to real workflows across vendor risk, compliance, AI governance, and cyber intelligence.",
];

export default function AboutPage() {
  return (
    <>
      {/* ─── A. Hero ─────────────────────────────────────────────────────── */}
      <section className="bg-bg text-text border-b border-hairline">
        <div className="container-site py-20 lg:py-24">
          <div className="max-w-3xl">
            <p className="eyebrow mb-4">About SecureLogic AI</p>
            <h1 className="text-[2.5rem] sm:text-5xl font-extrabold leading-[1.07] tracking-tight mb-6">
              Security teams shouldn&apos;t learn about risk last.
            </h1>
            <p className="text-lg text-text-body leading-relaxed">
              We built SecureLogic AI to help security teams turn external cyber and
              regulatory noise into clear, prioritized action across vendors, controls,
              AI systems, and obligations.
            </p>
          </div>
        </div>
      </section>

      {/* ─── B. Why we exist ─────────────────────────────────────────────── */}
      <section className="bg-bg-elevated border-t border-hairline">
        <div className="container-site py-20 lg:py-[100px]">
          <div className="grid lg:grid-cols-[0.8fr_1.2fr] gap-12">
            <div>
              <p className="eyebrow mb-4">Why we exist</p>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-text leading-tight">
                The problem isn&apos;t too few signals. It&apos;s no way to act on them.
              </h2>
            </div>
            <div className="space-y-6 text-text-body leading-relaxed text-[17px] max-w-2xl">
              <p>
                Security and GRC teams are buried in signal overload — advisories,
                vulnerabilities, regulatory shifts, and vendor incidents arriving faster
                than anyone can triage them.
              </p>
              <p>
                The tools meant to help are fragmented. Vulnerability data lives in one
                place, vendor risk in another, AI governance in a spreadsheet, and
                obligations in a binder. Nothing connects external developments back to
                the exposure they actually create.
              </p>
              <p>
                So the work falls to a handful of analysts, manually deciding what matters.
                SecureLogic AI exists to close that gap — to connect intelligence to real
                exposure and make the next decision obvious.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ─── C. What we do ───────────────────────────────────────────────── */}
      <section className="bg-bg">
        <div className="container-site py-20 lg:py-[100px]">
          <div className="max-w-2xl mb-12">
            <p className="eyebrow mb-4">What we do</p>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-text leading-tight">
              From signal to decision, in four moves.
            </h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {WHAT_WE_DO.map((item, i) => (
              <div key={item.title} className="card p-7">
                <p className="font-mono text-sm font-semibold text-accent mb-4">
                  {String(i + 1).padStart(2, "0")}
                </p>
                <h3 className="text-text font-bold text-base mb-2">{item.title}</h3>
                <p className="text-sm text-text-muted leading-relaxed">{item.copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── D. Who it's for ─────────────────────────────────────────────── */}
      <section className="bg-bg-elevated border-t border-hairline">
        <div className="container-site py-20 lg:py-[100px]">
          <div className="max-w-2xl mb-12">
            <p className="eyebrow mb-4">Who it&apos;s for</p>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-text leading-tight">
              Built for the teams carrying the most with the least.
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-5">
            {AUDIENCES.map((a) => (
              <div key={a.title} className="card p-7">
                <h3 className="text-text font-bold text-lg mb-2">{a.title}</h3>
                <p className="text-sm text-text-muted leading-relaxed">{a.copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── E. What we believe ──────────────────────────────────────────── */}
      <section className="bg-bg">
        <div className="container-site py-20 lg:py-[100px]">
          <div className="max-w-2xl mb-12">
            <p className="eyebrow mb-4">What we believe</p>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-text leading-tight">
              The principles behind the product.
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-5">
            {BELIEFS.map((b) => (
              <div key={b.title} className="card p-7">
                <span className="block w-8 h-px bg-accent mb-5" />
                <h3 className="text-text font-bold text-lg mb-3 leading-snug">{b.title}</h3>
                <p className="text-sm text-text-muted leading-relaxed">{b.copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── F. Operating principles ─────────────────────────────────────── */}
      <section className="bg-bg-elevated border-t border-hairline">
        <div className="container-site py-20 lg:py-[100px]">
          <div className="grid lg:grid-cols-[0.8fr_1.2fr] gap-12">
            <div>
              <p className="eyebrow mb-4">How we operate</p>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-text leading-tight">
                Trust is the product.
              </h2>
            </div>
            <ul className="space-y-4 max-w-2xl">
              {PRINCIPLES.map((p) => (
                <li key={p} className="flex items-start gap-3.5">
                  <span className="mt-0.5 flex-shrink-0 w-6 h-6 rounded-full bg-accent/15 text-accent flex items-center justify-center">
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                  <span className="text-text-body leading-relaxed pt-0.5">{p}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ─── G. CTA ──────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-bg border-t border-hairline">
        <div
          className="absolute inset-0 pointer-events-none"
          aria-hidden="true"
          style={{ background: "radial-gradient(ellipse 70% 70% at 50% 110%, rgba(0,196,180,0.13) 0%, transparent 65%)" }}
        />
        <div className="container-site relative py-24 text-center">
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-text leading-tight mb-8">
            See what we&apos;d surface for you.
          </h2>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/contact/" className="btn-primary">Request a demo</Link>
            <Link href="/#brief-signup" className="btn-outline">Start with the free brief</Link>
          </div>
        </div>
      </section>
    </>
  );
}
