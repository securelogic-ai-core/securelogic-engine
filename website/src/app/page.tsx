import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { BriefSignupForm } from "@/components/BriefSignupForm";
import { PricingCards } from "@/components/PricingCards";
import { SOURCES } from "@/lib/pricing";
import { CURRENTLY_IN_PLACE } from "@/lib/trust";

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

// Small reusable checkmark for trust rows / outcome lists.
function Check({ className = "w-3.5 h-3.5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
    </svg>
  );
}

const PILLARS = [
  {
    title: "Vendor Risk",
    Icon: IconVendor,
    href: "/platform/#vendor-risk",
    copy: "Assess vendors, monitor changes, track concerns, and tie external cyber developments back to risk automatically.",
  },
  {
    title: "AI Governance",
    Icon: IconAI,
    href: "/platform/#ai-governance",
    copy: "Evaluate AI systems, document governance controls, and track AI-related risks in a structured workflow.",
  },
  {
    title: "Compliance",
    Icon: IconCompliance,
    href: "/platform/#compliance",
    copy: "Manage obligations and assessments across SOC 2, ISO 27001, GDPR, HIPAA, and NIST CSF in one system.",
  },
  {
    title: "Cyber Intelligence",
    Icon: IconIntel,
    href: "/platform/#intelligence",
    copy: "Turn external signals into prioritized findings, domain scores, and recommended actions for leadership.",
  },
];

const STEPS = [
  {
    n: "01",
    title: "Ingest signals",
    copy: "Collect critical threat, vulnerability, regulatory, and AI-risk signals from 9 live sources.",
  },
  {
    n: "02",
    title: "Connect to your posture",
    copy: "Map each signal to your vendors, AI systems, controls, and obligations.",
  },
  {
    n: "03",
    title: "Score & prioritize",
    copy: "The SecureLogic Engine scores severity and relevance so the noise falls away.",
  },
  {
    n: "04",
    title: "Drive action",
    copy: "Act on clear, prioritized recommendations with owners and next steps.",
  },
  {
    n: "05",
    title: "Report to leadership",
    copy: "Roll posture, risk, and action into board-ready executive reporting.",
  },
];

// Who the platform is built for — honest positioning, not customer logos.
const PERSONAS = [
  "CISOs & Security Leaders",
  "GRC & Risk Teams",
  "Compliance Officers",
  "IT Directors",
  "Procurement & TPRM",
];

// Honest trust signals — every claim is verifiable; SOC 2 is stated as planned.
const TRUST_BADGES = [
  "GDPR & CCPA aligned",
  "NIST AI RMF aligned",
  "No AI training on your data",
  "SOC 2 Type II — planned",
];

// Why SecureLogic AI is different (not feature lists — differentiators).
const DIFFERENTIATORS = [
  {
    title: "One operating picture",
    copy: "Vendor risk, AI governance, compliance, and threat intelligence in a single connected model — not four disconnected tools.",
  },
  {
    title: "Explainable scoring",
    copy: "Every score and recommendation traces back to the underlying signal and rule. No black-box risk numbers.",
  },
  {
    title: "Responsible AI by design",
    copy: "Your content is never used to train models — ours or our providers'. AI assists; people decide.",
  },
  {
    title: "Built by security & GRC",
    copy: "Designed around real posture, assessment, and reporting workflows — by a team that does this work.",
  },
];

// What leaders get — outcome framing (qualitative, no invented metrics).
const OUTCOMES = [
  {
    stat: "Board-ready",
    label: "Executive reporting",
    copy: "Posture, top risks, and recommended actions in language leadership acts on.",
  },
  {
    stat: "One view",
    label: "Unified risk picture",
    copy: "Cyber, vendor, AI, and compliance exposure in one prioritized operating picture.",
  },
  {
    stat: "Audit-ready",
    label: "Continuous compliance",
    copy: "Controls, evidence, and gaps tracked across SOC 2, ISO 27001, NIST CSF, and more.",
  },
  {
    stat: "Fewer blind spots",
    label: "Third-party visibility",
    copy: "Vendor and AI-system exposure surfaced and tied back to your risk register.",
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
              <p className="text-lg text-text-body leading-relaxed max-w-xl mb-5">
                Security teams are drowning in alerts with no context, no prioritization,
                and no clear action.
              </p>
              <p className="text-base text-text-muted leading-relaxed max-w-xl mb-8">
                SecureLogic AI is the risk intelligence platform for security and GRC leaders —
                unifying cyber, vendor, AI governance, and compliance signals into one prioritized
                operating picture. Start with the weekly executive brief; grow into the full platform.
              </p>

              <BriefSignupForm />

              <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
                <Link href={TRIAL_HREF} className="text-accent font-semibold hover:text-accent-hover transition-colors">
                  Start a free platform trial →
                </Link>
                <Link href="/contact/" className="text-text-muted font-semibold hover:text-text transition-colors">
                  Book a demo →
                </Link>
              </div>

              <ul className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-text-muted">
                {["No credit card to start", "SSO / SAML available", "No AI training on your data"].map((t) => (
                  <li key={t} className="flex items-center gap-1.5">
                    <span className="text-accent"><Check className="w-3 h-3" /></span>
                    {t}
                  </li>
                ))}
              </ul>
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

      {/* ─── B2. Built for / trust signals ───────────────────────────────── */}
      <section className="bg-bg border-b border-hairline">
        <div className="container-site py-12">
          <div className="grid lg:grid-cols-2 gap-10 items-center">
            <div>
              <p className="pill-mono text-text-muted mb-4">Built for security &amp; GRC leaders</p>
              <ul className="flex flex-wrap gap-2.5">
                {PERSONAS.map((p) => (
                  <li
                    key={p}
                    className="px-3 py-1.5 rounded-full border border-hairline bg-bg-elevated text-sm text-text-body"
                  >
                    {p}
                  </li>
                ))}
              </ul>
            </div>
            <div className="lg:justify-self-end">
              <p className="pill-mono text-text-muted mb-4 lg:text-right">Security &amp; trust posture</p>
              <ul className="flex flex-wrap gap-2.5 lg:justify-end">
                {TRUST_BADGES.map((b) => (
                  <li
                    key={b}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-accent/25 bg-accent/5 text-sm text-text-body"
                  >
                    <span className="text-accent"><Check className="w-3 h-3" /></span>
                    {b}
                  </li>
                ))}
              </ul>
            </div>
          </div>
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

      {/* ─── C2. Why SecureLogic AI ──────────────────────────────────────── */}
      <section className="bg-bg-elevated border-t border-hairline">
        <div className="container-site py-20 lg:py-[100px]">
          <div className="max-w-2xl mb-12">
            <p className="eyebrow mb-4">Why SecureLogic AI</p>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-text leading-tight">
              A platform, not another point tool.
            </h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {DIFFERENTIATORS.map((d) => (
              <div key={d.title} className="card p-7">
                <span className="w-9 h-9 rounded-lg bg-accent/15 text-accent flex items-center justify-center mb-5">
                  <Check className="w-4 h-4" />
                </span>
                <h3 className="text-text font-bold text-base mb-2">{d.title}</h3>
                <p className="text-sm text-text-muted leading-relaxed">{d.copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── D. Platform overview (four pillars) ─────────────────────────── */}
      <section id="features" className="bg-bg border-t border-hairline">
        <div className="container-site py-20 lg:py-[100px]">
          <div className="max-w-2xl mb-12">
            <p className="eyebrow mb-4">Platform overview</p>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-text leading-tight mb-4">
              Four connected domains. One operating picture.
            </h2>
            <p className="text-text-muted leading-relaxed">
              Each domain runs on the same SecureLogic Engine, so a signal that touches a vendor,
              an AI system, or a control flows into one shared risk model — not four silos.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {PILLARS.map((p) => (
              <div key={p.title} className="card p-7 flex flex-col">
                <span className="w-10 h-10 rounded-lg bg-accent/15 text-accent flex items-center justify-center mb-5">
                  <p.Icon />
                </span>
                <h3 className="text-text font-bold text-lg mb-2">{p.title}</h3>
                <p className="text-sm text-text-muted leading-relaxed mb-6 flex-1">{p.copy}</p>
                <Link href={p.href} className="text-sm font-semibold text-accent hover:text-accent-hover transition-colors">
                  Explore {p.title} →
                </Link>
              </div>
            ))}
          </div>
          <div className="mt-10">
            <Link href="/platform/" className="btn-outline">See the full platform</Link>
          </div>
        </div>
      </section>

      {/* ─── E. How it works ─────────────────────────────────────────────── */}
      <section className="bg-bg-elevated border-t border-hairline">
        <div className="container-site py-20 lg:py-[100px]">
          <div className="max-w-2xl mb-12">
            <p className="eyebrow mb-4">How it works</p>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-text leading-tight mb-4">
              From raw signal to leadership-ready action.
            </h2>
            <p className="text-text-muted leading-relaxed">
              A repeatable, five-step workflow — the same engine behind every module.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {STEPS.map((s) => (
              <div key={s.n} className="card p-6">
                <p className="font-mono text-2xl font-semibold text-accent mb-4">{s.n}</p>
                <h3 className="text-text font-bold text-base mb-2">{s.title}</h3>
                <p className="text-sm text-text-muted leading-relaxed">{s.copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── F. Intelligence Brief spotlight ─────────────────────────────── */}
      <section className="bg-bg border-t border-hairline">
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

      {/* ─── F2. Executive outcomes ──────────────────────────────────────── */}
      <section className="bg-bg-elevated border-t border-hairline">
        <div className="container-site py-20 lg:py-[100px]">
          <div className="max-w-2xl mb-12">
            <p className="eyebrow mb-4">Executive outcomes</p>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-text leading-tight mb-4">
              What leadership actually gets.
            </h2>
            <p className="text-text-muted leading-relaxed">
              SecureLogic AI exists to turn scattered risk signals into decisions a board can stand behind.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {OUTCOMES.map((o) => (
              <div key={o.label} className="card p-7">
                <p className="text-accent font-extrabold text-2xl leading-tight mb-1">{o.stat}</p>
                <p className="pill-mono text-text-muted mb-3">{o.label}</p>
                <p className="text-sm text-text-muted leading-relaxed">{o.copy}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── F3. Security & trust preview ────────────────────────────────── */}
      <section className="bg-bg border-t border-hairline">
        <div className="container-site py-20 lg:py-[100px]">
          <div className="grid lg:grid-cols-2 gap-14 items-center">
            <div>
              <p className="eyebrow mb-4">Security &amp; trust</p>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-text leading-tight mb-6">
                We hold ourselves to the standards we help you meet.
              </h2>
              <p className="text-text-body leading-relaxed mb-8">
                We&apos;re a security and GRC platform, so trust is the product. Here&apos;s what&apos;s
                in place today — and we&apos;re transparent about what&apos;s still on the roadmap.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Link href="/trust/" className="btn-primary">Visit the Trust Center</Link>
                <Link href="/security/" className="btn-outline">Read the security detail</Link>
              </div>
            </div>
            <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-3.5">
              {CURRENTLY_IN_PLACE.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm text-text-body leading-relaxed">
                  <span className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full bg-accent/15 text-accent flex items-center justify-center">
                    <Check className="w-3 h-3" />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ─── G. Pricing ──────────────────────────────────────────────────── */}
      <section className="bg-bg-elevated border-t border-hairline">
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
      <section className="relative overflow-hidden bg-bg border-t border-hairline">
        <div
          className="absolute inset-0 pointer-events-none"
          aria-hidden="true"
          style={{ background: "radial-gradient(ellipse 70% 70% at 50% 110%, rgba(0,196,180,0.14) 0%, transparent 65%)" }}
        />
        <div className="container-site relative py-24 text-center">
          <div className="flex justify-center mb-7">
            <Image src="/branding/securelogic-ai-logo.png" alt="SecureLogic AI" width={48} height={48} className="rounded-xl" />
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-text leading-tight mb-4">
            Start with the brief. Stay for the platform.
          </h2>
          <p className="text-text-muted leading-relaxed max-w-xl mx-auto mb-8">
            Pick the path that fits — read the free brief, trial the platform, or have us walk
            your team through it.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/#brief-signup" className="btn-primary">Get the Free Brief</Link>
            <Link href={TRIAL_HREF} className="btn-outline">Start Free Trial</Link>
            <Link href="/contact/" className="btn-outline">Book a Demo</Link>
          </div>
        </div>
      </section>
    </>
  );
}
