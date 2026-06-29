import type { Metadata } from "next";
import Link from "next/link";
import { SECURITY_OVERVIEW_PDF } from "@/lib/nav";
import {
  SECURITY_EMAIL,
  SUBPROCESSORS,
  CURRENTLY_IN_PLACE,
  PLANNED_MILESTONES,
} from "@/lib/trust";

export const metadata: Metadata = {
  title: "Trust Center",
  description:
    "The SecureLogic AI Trust Center — security posture, data protection, subprocessors, compliance roadmap, privacy, and legal documents in one place.",
  openGraph: {
    title: "Trust Center — SecureLogic AI",
    description:
      "Security, privacy, compliance posture, subprocessors, and legal documents for SecureLogic AI — in one place.",
  },
};

const PILLARS = [
  {
    title: "Security",
    copy: "Multi-layer encryption, immutable audit logs, MFA/SSO, and automated cross-tenant isolation testing on every change.",
    href: "/security/",
    cta: "Security overview",
  },
  {
    title: "Privacy",
    copy: "We do not sell or share personal information. Full CCPA/CPRA, multi-state, and GDPR/UK rights with a documented data-rights process.",
    href: "/privacy/",
    cta: "Privacy Policy",
  },
  {
    title: "Responsible AI",
    copy: "Per-feature AI disclosure, no training on Customer Content, human oversight, and alignment to the NIST AI Risk Management Framework.",
    href: "/ai-policy/",
    cta: "AI Policy",
  },
];

const LEGAL_DOCS: { label: string; href: string; external?: boolean }[] = [
  { label: "Terms of Service", href: "/terms/" },
  { label: "Privacy Policy", href: "/privacy/" },
  { label: "AI Transparency & Responsible Use Policy", href: "/ai-policy/" },
  { label: "Security Overview (PDF)", href: SECURITY_OVERVIEW_PDF, external: true },
];

export default function TrustCenterPage() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden bg-bg text-text border-b border-hairline">
        <div
          className="absolute inset-0 pointer-events-none"
          aria-hidden="true"
          style={{
            background:
              "radial-gradient(ellipse 60% 80% at 50% 120%, rgba(0,196,180,0.13) 0%, transparent 65%)",
          }}
        />
        <div className="container-site relative py-20 lg:py-24">
          <div className="max-w-3xl">
            <p className="eyebrow mb-4">Trust Center</p>
            <h1 className="text-[2.5rem] sm:text-5xl font-extrabold leading-[1.07] tracking-tight mb-6">
              Built to be trusted with your risk data.
            </h1>
            <p className="text-lg text-text-body leading-relaxed">
              SecureLogic AI is a security and GRC platform — so we hold ourselves to the standards
              we help our customers meet. Everything you need for due diligence: our security
              posture, data protection, subprocessors, compliance roadmap, and legal documents.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-3">
              <a className="btn-primary" href={SECURITY_OVERVIEW_PDF} target="_blank" rel="noopener noreferrer">
                Download Security Overview (PDF)
              </a>
              <Link href="/security/" className="btn-outline">
                Read the security detail
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Three pillars */}
      <section className="bg-bg-elevated border-b border-hairline">
        <div className="container-site py-20 lg:py-[100px]">
          <div className="grid md:grid-cols-3 gap-5">
            {PILLARS.map((p) => (
              <div key={p.title} className="card p-7 flex flex-col">
                <h2 className="text-text font-bold text-lg mb-2">{p.title}</h2>
                <p className="text-sm text-text-muted leading-relaxed mb-6 flex-1">{p.copy}</p>
                <Link href={p.href} className="text-sm font-semibold text-accent hover:text-accent-hover transition-colors">
                  {p.cta} →
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Compliance posture — honest */}
      <section className="bg-bg">
        <div className="container-site py-20 lg:py-[100px]">
          <div className="max-w-2xl mb-12">
            <p className="eyebrow mb-4">Compliance posture</p>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-text leading-tight mb-4">
              Where we are, where we&apos;re going.
            </h2>
            <p className="text-text-muted leading-relaxed">
              We do not currently hold independent certifications such as SOC 2 Type II or ISO 27001.
              We rely on the compliance posture of our infrastructure providers and the engineering
              controls built into the platform, and we are maturing deliberately.
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-5">
            <div className="card p-8">
              <h3 className="text-text font-bold text-lg mb-5">Currently in place</h3>
              <ul className="space-y-3">
                {CURRENTLY_IN_PLACE.map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm text-text-body leading-relaxed">
                    <span className="mt-0.5 w-4 h-4 rounded-full bg-accent/15 text-accent flex items-center justify-center flex-shrink-0">
                      <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="card p-8">
              <h3 className="text-text font-bold text-lg mb-5">Planned milestones</h3>
              <ul className="space-y-3">
                {PLANNED_MILESTONES.map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm text-text-body leading-relaxed">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-text-muted/60 flex-shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Subprocessors */}
      <section className="bg-bg-elevated border-y border-hairline">
        <div className="container-site py-20 lg:py-[100px]">
          <div className="max-w-2xl mb-10">
            <p className="eyebrow mb-4">Subprocessors</p>
            <h2 className="text-3xl sm:text-4xl font-extrabold text-text leading-tight">
              The infrastructure partners behind the platform.
            </h2>
          </div>
          <ul className="grid sm:grid-cols-2 gap-x-8 gap-y-3 max-w-3xl">
            {SUBPROCESSORS.map(([name, desc]) => (
              <li key={name} className="text-sm text-text-body leading-relaxed">
                <span className="font-semibold text-text">{name}</span> — {desc}
              </li>
            ))}
          </ul>
          <p className="text-sm text-text-muted mt-8">
            The complete, current subprocessor list lives in our{" "}
            <Link href="/privacy/" className="text-accent hover:text-accent-hover underline">
              Privacy Policy
            </Link>
            .
          </p>
        </div>
      </section>

      {/* Legal documents + disclosure */}
      <section className="bg-bg">
        <div className="container-site py-20 lg:py-[100px]">
          <div className="grid lg:grid-cols-2 gap-14">
            <div>
              <p className="eyebrow mb-4">Legal documents</p>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-text leading-tight mb-8">
                Everything in writing.
              </h2>
              <ul className="space-y-3">
                {LEGAL_DOCS.map((doc) =>
                  doc.external ? (
                    <li key={doc.href}>
                      <a
                        href={doc.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent hover:text-accent-hover font-medium transition-colors"
                      >
                        {doc.label} →
                      </a>
                    </li>
                  ) : (
                    <li key={doc.href}>
                      <Link href={doc.href} className="text-accent hover:text-accent-hover font-medium transition-colors">
                        {doc.label} →
                      </Link>
                    </li>
                  )
                )}
              </ul>
            </div>
            <div className="card bg-bg-elevated-2 border-accent/30 p-8">
              <h2 className="text-text font-bold text-lg mb-2">Report a vulnerability</h2>
              <p className="text-sm text-text-muted leading-relaxed mb-6">
                We welcome responsible disclosure. Email us with enough detail to reproduce the
                issue and we&apos;ll acknowledge within 5 business days.
              </p>
              <a href={`mailto:${SECURITY_EMAIL}`} className="btn-primary w-full">
                {SECURITY_EMAIL}
              </a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
