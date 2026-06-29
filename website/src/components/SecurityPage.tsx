import Link from "next/link";
import { SECURITY_OVERVIEW_PDF } from "@/lib/nav";
import {
  SECURITY_EMAIL,
  DATA_PROTECTION_ROWS,
  AUTH_ITEMS,
  MONITORING_ITEMS,
  SUBPROCESSORS,
  CURRENTLY_IN_PLACE,
  PLANNED_MILESTONES,
  DISCLOSURE_COMMITMENTS,
} from "@/lib/trust";

const APPROACH_CARDS = [
  {
    title: "Built-in by design",
    body: "Every code change runs through six required security checks before it can reach production. Cross-tenant isolation is tested automatically on every pull request.",
  },
  {
    title: "Defense in depth",
    body: "Multiple security layers protect customer data — from edge-level DDoS protection, through application-layer controls, to database-enforced audit immutability.",
  },
  {
    title: "Transparent posture",
    body: "We tell you what's in place and what isn't. Our full Security Overview includes a Maturity & Roadmap section so you can calibrate expectations.",
  },
];

const RELATED_DOCS = [
  { label: "Trust Center", href: "/trust/" },
  { label: "Terms of Service", href: "/terms/" },
  { label: "Privacy Policy", href: "/privacy/" },
  { label: "AI Transparency & Responsible Use Policy", href: "/ai-policy/" },
];

function CheckItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-sm text-text-body leading-relaxed">
      <span className="mt-0.5 w-4 h-4 rounded-full bg-accent/15 text-accent flex items-center justify-center flex-shrink-0">
        <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
      </span>
      {children}
    </li>
  );
}

export function SecurityPage() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden bg-bg border-b border-hairline pt-20 pb-20 px-4 text-center">
        <div
          className="absolute inset-0 pointer-events-none"
          aria-hidden="true"
          style={{
            background:
              "radial-gradient(ellipse 60% 80% at 50% 120%, rgba(0,196,180,0.13) 0%, transparent 65%)",
          }}
        />
        <div className="relative max-w-2xl mx-auto">
          <p className="eyebrow mb-4">Security</p>
          <h1 className="text-4xl font-extrabold text-text mb-4">Security at SecureLogic AI</h1>
          <p className="text-lg text-text-body leading-relaxed mb-8">
            We&apos;re a compliance and risk platform — and we hold ourselves to the same standards
            we help our customers meet. Here&apos;s how we protect your data.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <a className="btn-primary" href={SECURITY_OVERVIEW_PDF} target="_blank" rel="noopener noreferrer">
              Download Full Security Overview (PDF)
            </a>
            <a className="btn-outline" href={`mailto:${SECURITY_EMAIL}`}>
              Report a Vulnerability
            </a>
          </div>
        </div>
      </section>

      {/* How we approach security */}
      <section className="py-16 px-4 bg-bg">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-extrabold text-text mb-4 text-center">
            How we approach security
          </h2>
          <p className="text-text-body leading-relaxed max-w-3xl mx-auto text-center mb-12">
            Security is engineered into our platform from the ground up — not bolted on. Every
            feature is designed with confidentiality, integrity, and availability as primary
            requirements. We aim to be transparent about both what we do well and where we&apos;re
            still maturing.
          </p>
          <div className="grid sm:grid-cols-3 gap-6">
            {APPROACH_CARDS.map((card) => (
              <div key={card.title} className="card p-8">
                <h3 className="text-lg font-bold text-text mb-3">{card.title}</h3>
                <p className="text-sm text-text-muted leading-relaxed">{card.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Data protection table */}
      <section className="bg-bg-elevated border-y border-hairline py-16 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-extrabold text-text mb-8 text-center">
            Your data, protected at every layer
          </h2>
          <div className="overflow-x-auto">
            <table className="border-collapse w-full border border-hairline text-sm card overflow-hidden">
              <thead>
                <tr>
                  <th className="bg-bg-elevated-2 p-3 text-left font-semibold border-b border-hairline text-text w-1/3">
                    Layer
                  </th>
                  <th className="bg-bg-elevated-2 p-3 text-left font-semibold border-b border-hairline text-text">
                    Control
                  </th>
                </tr>
              </thead>
              <tbody>
                {DATA_PROTECTION_ROWS.map(([layer, control]) => (
                  <tr key={layer}>
                    <td className="p-3 border-b border-hairline font-semibold text-text align-top">
                      {layer}
                    </td>
                    <td className="p-3 border-b border-hairline text-text-body align-top">
                      {control}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Authentication + Monitoring */}
      <section className="py-16 px-4 bg-bg">
        <div className="max-w-5xl mx-auto grid md:grid-cols-2 gap-12">
          <div>
            <h2 className="text-2xl font-extrabold text-text mb-6">
              Strong authentication, organizational control
            </h2>
            <ul className="space-y-3">
              {AUTH_ITEMS.map((item) => (
                <CheckItem key={item}>{item}</CheckItem>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="text-2xl font-extrabold text-text mb-6">We watch for trouble, in real time</h2>
            <ul className="space-y-3">
              {MONITORING_ITEMS.map((item) => (
                <CheckItem key={item}>{item}</CheckItem>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Subprocessors */}
      <section className="bg-bg-elevated border-y border-hairline py-16 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-extrabold text-text mb-4 text-center">
            We work with trusted infrastructure partners
          </h2>
          <p className="text-text-body leading-relaxed max-w-3xl mx-auto text-center mb-10">
            The Services rely on a small set of third-party providers selected for their published
            security posture and compliance attestations. Many of our subprocessors maintain SOC 2
            Type II or equivalent certifications.
          </p>
          <ul className="grid sm:grid-cols-2 gap-x-8 gap-y-3 max-w-3xl mx-auto">
            {SUBPROCESSORS.map(([name, desc]) => (
              <li key={name} className="text-sm text-text-body leading-relaxed">
                <span className="font-semibold text-text">{name}</span> — {desc}
              </li>
            ))}
          </ul>
          <p className="text-sm text-text-muted text-center mt-10">
            For the full subprocessor list, see our{" "}
            <Link href="/privacy/" className="text-accent hover:text-accent-hover underline">
              Privacy Policy
            </Link>
            .
          </p>
        </div>
      </section>

      {/* Compliance posture */}
      <section className="py-16 px-4 bg-bg">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-extrabold text-text mb-4 text-center">
            Where we are, where we&apos;re going
          </h2>
          <p className="text-text-body leading-relaxed mb-12">
            SecureLogic AI does not currently hold independent compliance certifications like SOC 2
            Type II or ISO 27001. As an early-stage company, we rely on the compliance posture of
            our underlying providers and the engineering controls we&apos;ve built into the
            platform. We are committed to maturing our compliance posture as the platform and
            customer base grow.
          </p>
          <div className="grid md:grid-cols-2 gap-8">
            <div className="card p-8">
              <h3 className="text-lg font-bold text-text mb-5">Currently in place</h3>
              <ul className="space-y-3">
                {CURRENTLY_IN_PLACE.map((item) => (
                  <CheckItem key={item}>{item}</CheckItem>
                ))}
              </ul>
            </div>
            <div className="card p-8">
              <h3 className="text-lg font-bold text-text mb-5">Planned milestones</h3>
              <ul className="space-y-3 text-sm text-text-body">
                {PLANNED_MILESTONES.map((item) => (
                  <li key={item} className="flex items-start gap-2.5 leading-relaxed">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-text-muted/60 flex-shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Responsible disclosure */}
      <section className="bg-bg-elevated border-y border-hairline py-16 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl font-extrabold text-text mb-4">Found a vulnerability? Tell us.</h2>
          <p className="text-text-body leading-relaxed mb-6">
            SecureLogic AI welcomes responsible disclosure of suspected security vulnerabilities. If
            you believe you&apos;ve discovered a vulnerability, please email us with details that
            allow us to reproduce the issue.
          </p>
          <a
            href={`mailto:${SECURITY_EMAIL}`}
            className="inline-block text-xl font-bold text-accent hover:text-accent-hover mb-8"
          >
            {SECURITY_EMAIL}
          </a>
          <ul className="space-y-3 max-w-md mx-auto text-left mb-8">
            {DISCLOSURE_COMMITMENTS.map((item) => (
              <CheckItem key={item}>{item}</CheckItem>
            ))}
          </ul>
          <p className="text-sm text-text-muted">
            For our full Responsible Disclosure Policy, see the{" "}
            <a
              href={SECURITY_OVERVIEW_PDF}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:text-accent-hover underline"
            >
              Security Overview PDF
            </a>
            .
          </p>
        </div>
      </section>

      {/* Read the full Security Overview */}
      <section className="py-16 px-4 bg-bg">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl font-extrabold text-text mb-4">Read the full Security Overview</h2>
          <p className="text-text-body leading-relaxed mb-8">
            For complete details on our security program, architecture, and controls, download our
            full Security Overview document.
          </p>
          <a className="btn-primary" href={SECURITY_OVERVIEW_PDF} target="_blank" rel="noopener noreferrer">
            Download Security Overview (PDF)
          </a>

          <div className="mt-14 pt-10 border-t border-hairline">
            <h3 className="pill-mono text-text-muted mb-5">Related documents</h3>
            <ul className="space-y-2">
              {RELATED_DOCS.map((doc) => (
                <li key={doc.href}>
                  <Link href={doc.href} className="text-accent hover:text-accent-hover underline">
                    {doc.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-sm text-text-muted mt-12">
            Questions about our security program? Contact us at{" "}
            <a
              href={`mailto:${SECURITY_EMAIL}`}
              className="text-accent hover:text-accent-hover underline"
            >
              {SECURITY_EMAIL}
            </a>
            .
          </p>
          <p className="text-xs text-text-muted/70 mt-8">
            &copy; 2026 Threat Loom, LLC d/b/a SecureLogic AI. All rights reserved.
          </p>
        </div>
      </section>
    </>
  );
}
