import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { BriefSignupForm } from "@/components/BriefSignupForm";
import { PricingCards } from "@/components/PricingCards";
import { SOURCES } from "@/lib/pricing";

export const metadata: Metadata = {
  title: "SecureLogic AI — Cyber Risk Intelligence. Delivered Weekly.",
  description:
    "SecureLogic AI helps security teams turn cyber, vendor, AI governance, and compliance signals into clear, prioritized action.",
  openGraph: {
    title: "SecureLogic AI — Cyber Risk Intelligence. Delivered Weekly.",
    description:
      "SecureLogic AI helps security teams turn cyber, vendor, AI governance, and compliance signals into clear, prioritized action.",
  },
};

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.securelogicai.com";
const TRIAL_HREF = `${APP_URL}/signup?plan=platform_annual`;

// ── Pillar icons ───────────────────────────────────────────────────────
function IconVendor() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.684 13.342C8.886 12.938 9 12.482 9 12s-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
    </svg>
  );
}
function IconAI() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 3H7a2 2 0 00-2 2v2m4-4h6m-6 0V1m6 2h2a2 2 0 012 2v2m0 0V9m0-2h2M21 9v6m0 0v2a2 2 0 01-2 2h-2m0 0H9m6 0v2m-6-2H7a2 2 0 01-2-2v-2m0 0V9m0 6H3M3 9V7a2 2 0 012-2h2m2 4h6v6H9V9z" />
    </svg>
  );
}
function IconCompliance() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  );
}
function IconIntel() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
    </svg>
  );
}

const PILLARS = [
  {
    title: "Vendor Risk",
    Icon: IconVendor,
    copy: "Assess vendors, monitor changes, track concerns, and tie external cyber developments back to risk automatically.",
  },
  {
    title: "AI Governance",
    Icon: IconAI,
    copy: "Evaluate AI systems, document governance controls, and track AI-related risks in a structured workflow.",
  },
  {
    title: "Compliance",
    Icon: IconCompliance,
    copy: "Manage obligations and assessments across SOC 2, ISO 27001, GDPR, HIPAA, and NIST CSF in one system.",
  },
  {
    title: "Cyber Intelligence",
    Icon: IconIntel,
    copy: "Turn external signals into prioritized findings, domain scores, and recommended actions for leadership.",
  },
];

const STEPS = [
  {
    n: "01",
    title: "Ingest signals",
    copy: "Collect critical threat signals and vulnerability data from 9 live sources.",
  },
  {
    n: "02",
    title: "Connect to your posture",
    copy: "Map the intelligence to your vendors, AI systems, and controls.",
  },
  {
    n: "03",
    title: "Drive action",
    copy: "Act on clear, prioritized recommendations delivered weekly.",
  },
];

export default function HomePage() {
  return (
    <>
      {/* ─── A. Hero ─────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-bg text-text">
        <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
          <div className="absolute inset-0 bg-grid opacity-[0.05]" />
          <div
            className="absolute inset-0"
            style={{ background: "radial-gradient(ellipse 60% 60% at 12% 30%, rgba(0,196,180,0.14) 0%, transparent 60%)" }}
          />
          <div
            className="absolute inset-0"
            style={{ background: "radial-gradient(ellipse 100% 100% at 50% 50%, transparent 45%, rgba(10,22,40,0.85) 100%)" }}
          />
        </div>

        <div className="container-site relative py-20 lg:py-28">
          <div className="grid lg:grid-cols-[1fr_440px] xl:grid-cols-[1fr_480px] gap-14 xl:gap-20 items-center">
            {/* Left */}
            <div>
              <p className="eyebrow mb-5">Cyber Risk Intelligence</p>
              <h1 className="font-extrabold leading-[1.05] tracking-tight text-[2.5rem] sm:text-5xl lg:text-[4rem] mb-6">
                Cyber Risk Intelligence.
                <br />
                <span className="text-accent">Delivered Weekly.</span>
              </h1>
              <p className="text-lg text-text-body leading-relaxed max-w-xl mb-8">
                Security teams are drowning in alerts with no context, no prioritization,
                and no clear action.
              </p>

              <BriefSignupForm />

              <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                <Link href={TRIAL_HREF} className="text-accent font-semibold hover:text-accent-hover transition-colors">
                  Or start a free platform trial →
                </Link>
              </div>
            </div>

            {/* Right — product-style brief card */}
            <div
              className="card overflow-hidden"
              style={{ boxShadow: "0 0 0 1px rgba(0,196,180,0.14), 0 0 70px rgba(0,196,180,0.12), 0 30px 70px rgba(0,0,0,0.55)" }}
            >
              <div className="bg-bg-elevated-2 border-b border-hairline px-5 py-4 flex items-center gap-2.5">
                <Image src="/branding/securelogic-ai-logo.png" alt="" width={18} height={18} className="rounded opacity-80" aria-hidden="true" />
                <div className="leading-none">
                  <p className="pill-mono text-accent leading-none mb-1">Intelligence Brief</p>
                  <p className="text-[11px] text-text-muted leading-none">SecureLogic AI · Weekly Edition</p>
                </div>
              </div>
              <div className="p-5">
                <div className="bg-bg rounded-xl p-4 mb-4 border border-hairline">
                  <p className="pill-mono text-text-muted mb-4">Signal Snapshot</p>
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { count: "3", label: "Critical", color: "text-danger" },
                      { count: "7", label: "High", color: "text-warning" },
                      { count: "12", label: "Medium", color: "text-yellow-400" },
                      { count: "9", label: "Low", color: "text-text-muted" },
                    ].map((m) => (
                      <div key={m.label} className="text-center">
                        <p className={`text-2xl font-extrabold tabular-nums leading-none ${m.color}`}>{m.count}</p>
                        <p className="text-[9px] uppercase tracking-wide text-text-muted mt-1.5 leading-none">{m.label}</p>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  {[
                    { cat: "VULNERABILITY", sev: "CRITICAL", sevColor: "text-danger", bar: "bg-danger/70", title: "Microsoft SmartScreen zero-day exploited in the wild" },
                    { cat: "VENDOR RISK", sev: "HIGH", sevColor: "text-warning", bar: "bg-warning/70", title: "Critical patch issued for widely-deployed network appliance" },
                    { cat: "AI GOVERNANCE", sev: "HIGH", sevColor: "text-warning", bar: "bg-warning/70", title: "EU AI Act enforcement timeline confirmed for high-risk systems" },
                  ].map((s) => (
                    <div key={s.title} className="flex overflow-hidden rounded-lg border border-hairline">
                      <div className={`w-1 flex-shrink-0 ${s.bar}`} />
                      <div className="flex-1 bg-bg-elevated px-3 py-2.5">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-[10px] font-bold uppercase tracking-wide text-accent">{s.cat}</span>
                          <span className="text-hairline text-[10px]">·</span>
                          <span className={`text-[10px] font-bold uppercase tracking-wide ${s.sevColor}`}>{s.sev}</span>
                        </div>
                        <p className="text-xs text-text-body leading-snug">{s.title}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-text-muted mt-4 pt-3.5 border-t border-hairline">+ 28 more signals this issue</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── B. Sources bar ──────────────────────────────────────────────── */}
      <section id="sources" className="bg-bg-elevated border-y border-hairline">
        <div className="container-site py-10">
          <p className="pill-mono text-text-muted text-center mb-5">Sources we monitor</p>
          <ul className="flex flex-wrap items-center justify-center gap-x-7 gap-y-3">
            {SOURCES.map((source) => (
              <li key={source} className="text-sm font-medium text-text-body">{source}</li>
            ))}
          </ul>
          <p className="text-center text-xs text-text-muted mt-5">
            Covering vulnerabilities, threats, incidents &amp; AI risks.
          </p>
        </div>
      </section>

      {/* ─── C. Problem statement ────────────────────────────────────────── */}
      <section className="bg-bg">
        <div className="container-site py-20 lg:py-[100px]">
          <div className="max-w-3xl">
            <h2 className="text-3xl sm:text-4xl lg:text-[2.5rem] font-extrabold text-text leading-tight mb-6">
              Most security teams have alerts. Few have intelligence.
            </h2>
            <p className="text-lg text-text-body leading-relaxed">
              Most tools generate more noise than clarity. SecureLogic AI turns external
              cyber signals, vendor exposure, AI governance concerns, and compliance
              obligations into one prioritized view your team can actually act on.
            </p>
          </div>
        </div>
      </section>

      {/* ─── D. Four pillars ─────────────────────────────────────────────── */}
      <section id="features" className="bg-bg-elevated border-t border-hairline">
        <div className="container-site py-20 lg:py-[100px]">
          <div className="max-w-2xl mb-12">
            <p className="eyebrow mb-4">Platform</p>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-text leading-tight">
              Four pillars. One operating picture.
            </h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {PILLARS.map((p) => (
              <div key={p.title} className="card p-7 flex flex-col">
                <span className="w-10 h-10 rounded-lg bg-accent/15 text-accent flex items-center justify-center mb-5">
                  <p.Icon />
                </span>
                <h3 className="text-text font-bold text-lg mb-2">{p.title}</h3>
                <p className="text-sm text-text-muted leading-relaxed mb-6 flex-1">{p.copy}</p>
                <Link href={TRIAL_HREF} className="btn-outline w-full">Start Free Trial</Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── E. How it works ─────────────────────────────────────────────── */}
      <section className="bg-bg">
        <div className="container-site py-20 lg:py-[100px]">
          <div className="max-w-2xl mb-12">
            <p className="eyebrow mb-4">How it works</p>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-text leading-tight">
              How SecureLogic AI Works
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-5">
            {STEPS.map((s) => (
              <div key={s.n} className="card p-7">
                <p className="font-mono text-2xl font-semibold text-accent mb-4">{s.n}</p>
                <h3 className="text-text font-bold text-lg mb-2">{s.title}</h3>
                <p className="text-sm text-text-muted leading-relaxed">{s.copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── F. Intelligence Brief spotlight ─────────────────────────────── */}
      <section className="bg-bg-elevated border-t border-hairline">
        <div className="container-site py-20 lg:py-[100px]">
          <div className="grid lg:grid-cols-2 gap-14 items-center">
            {/* Brief preview card */}
            <div className="card overflow-hidden" style={{ boxShadow: "0 24px 60px rgba(0,0,0,0.4)" }}>
              <div className="bg-bg-elevated-2 border-b border-hairline px-6 py-4 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Image src="/branding/securelogic-ai-logo.png" alt="" width={18} height={18} className="rounded opacity-80" aria-hidden="true" />
                  <p className="pill-mono text-accent">Intelligence Brief</p>
                </div>
                <p className="text-[11px] text-text-muted font-mono">Issue #27 · Mon, Apr 20, 2026</p>
              </div>
              <div className="p-6">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-accent">Vulnerability</span>
                  <span className="text-hairline text-[10px]">·</span>
                  <span className="text-[10px] font-bold uppercase tracking-wide text-danger">Critical</span>
                </div>
                <h3 className="text-text font-bold text-lg leading-snug mb-1.5">
                  Microsoft SmartScreen Zero-Day Exploited in the Wild
                </h3>
                <p className="font-mono text-xs text-text-muted mb-5">CVE-2024-21412</p>

                <p className="pill-mono text-text-muted mb-3">Why It Matters</p>
                <ul className="space-y-2.5 text-sm text-text-body">
                  {[
                    "Attackers bypass SmartScreen protections to deliver malware with no security warning.",
                    "Active exploitation is already confirmed against unpatched Windows endpoints.",
                    "A patch is available now — prioritize deployment across exposed assets.",
                  ].map((b) => (
                    <li key={b} className="flex items-start gap-2.5">
                      <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0" />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Value bullets */}
            <div>
              <p className="eyebrow mb-4">The Brief</p>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-text leading-tight mb-8">
                Know Where You Stand. SecureLogic AI Connects the Dots.
              </h2>
              <ul className="space-y-5 mb-10">
                {[
                  "See critical alerts scored & explained",
                  "Focus on what's actionable for your org",
                  "Receive intelligence in a simple 3-step format",
                ].map((v) => (
                  <li key={v} className="flex items-start gap-3.5">
                    <span className="mt-0.5 flex-shrink-0 w-6 h-6 rounded-full bg-accent/15 text-accent flex items-center justify-center">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    <span className="text-text-body text-base leading-relaxed pt-0.5">{v}</span>
                  </li>
                ))}
              </ul>
              <div className="flex flex-col sm:flex-row gap-3">
                <Link href="/#brief-signup" className="btn-primary">Get the Free Brief</Link>
                <Link href={TRIAL_HREF} className="btn-outline">Start Free Trial</Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── G. Pricing ──────────────────────────────────────────────────── */}
      <section className="bg-bg border-t border-hairline">
        <div className="container-site py-20 lg:py-[100px]">
          <div className="max-w-2xl mb-12">
            <p className="eyebrow mb-4">Pricing</p>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-text leading-tight mb-4">
              Simple, transparent pricing.
            </h2>
            <p className="text-text-muted leading-relaxed">
              Start with the weekly brief. Upgrade when you need personalized intelligence,
              team distribution, and the full risk platform.
            </p>
          </div>
          <PricingCards appUrl={APP_URL} />
          <div className="mt-8">
            <Link href="/pricing/" className="text-sm font-semibold text-accent hover:text-accent-hover transition-colors">
              Compare all plans and details →
            </Link>
          </div>
        </div>
      </section>

      {/* ─── H. Final CTA ────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-bg-elevated border-t border-hairline">
        <div
          className="absolute inset-0 pointer-events-none"
          aria-hidden="true"
          style={{ background: "radial-gradient(ellipse 70% 70% at 50% 110%, rgba(0,196,180,0.14) 0%, transparent 65%)" }}
        />
        <div className="container-site relative py-24 text-center">
          <div className="flex justify-center mb-7">
            <Image src="/branding/securelogic-ai-logo.png" alt="SecureLogic AI" width={48} height={48} className="rounded-xl" />
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-text leading-tight mb-8">
            Start with the brief. Stay for the platform.
          </h2>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/#brief-signup" className="btn-primary">Get the Free Brief</Link>
            <Link href={TRIAL_HREF} className="btn-outline">Start Free Trial</Link>
          </div>
        </div>
      </section>
    </>
  );
}
