import Link from "next/link";

const PDF_PATH = "/SecureLogic-AI-Security-Overview-v1.pdf";

const PRIMARY_CTA =
  "inline-flex items-center justify-center bg-teal-600 hover:bg-teal-500 text-white font-semibold px-6 py-3 rounded-lg transition";
const SECONDARY_CTA =
  "inline-flex items-center justify-center bg-transparent border border-slate-300 text-slate-700 hover:bg-slate-50 font-semibold px-6 py-3 rounded-lg transition";

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

const DATA_PROTECTION_ROWS = [
  ["In transit", "TLS encryption for all connections including database"],
  ["At rest", "Infrastructure-provider encryption (Render, Cloudflare R2)"],
  ["Sensitive fields", "Application-layer AES-256-GCM encryption with separate keys"],
  ["Passwords", "Argon2id hashing meeting OWASP recommendations"],
  ["Audit logs", "Database-trigger-enforced immutability"],
  ["AI processing", "No customer content used for AI model training, ours or providers'"],
];

const AUTH_ITEMS = [
  "Multi-Factor Authentication (TOTP) supported for all accounts",
  "Organization-level MFA enforcement for administrators",
  "Argon2id password hashing with reuse prevention",
  "Account lockout after 5 failed login attempts",
  "SAML-based Single Sign-On (SSO) for enterprise customers",
  "API keys are hashed at rest, revocable at any time, with optional expiration",
];

const MONITORING_ITEMS = [
  "90+ event types tracked in immutable security audit logs",
  "Automated anomaly detection for credential stuffing and API key probing",
  "Real-time operator alerts via secure webhook for security-relevant events",
  "Application error monitoring via Sentry with sensitive data redacted before transmission",
];

const SUBPROCESSORS = [
  ["Render", "application hosting and managed databases"],
  ["Cloudflare", "content delivery, DDoS protection, object storage"],
  ["Stripe", "payment processing (PCI DSS Level 1)"],
  ["Anthropic", "large language model AI services"],
  ["OpenAI", "speech-to-text transcription"],
  ["Sentry", "application error monitoring"],
  ["Resend", "transactional email delivery"],
];

const CURRENTLY_IN_PLACE = [
  "Multi-layer encryption (in transit, at rest, application-layer)",
  "Immutable security audit logs",
  "Multi-Factor Authentication and SSO support",
  "Automated security testing on every code change",
  "Anomaly detection and real-time operator alerting",
];

const PLANNED_MILESTONES = [
  "Independent third-party penetration testing",
  "SOC 2 Type II attestation",
  "Documented Incident Response runbook",
  "Published Business Continuity and Disaster Recovery objectives",
  "Bug bounty program",
];

const DISCLOSURE_COMMITMENTS = [
  "Acknowledge your report within 5 business days",
  "Provide a substantive response within 30 days",
  "Credit researchers who report responsibly (with permission)",
];

const RELATED_DOCS = [
  { label: "Terms of Service", href: "/terms/" },
  { label: "Privacy Policy", href: "/privacy/" },
  { label: "AI Transparency & Responsible Use Policy", href: "/ai-policy/" },
];

function CheckItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2.5 text-sm text-slate-700 leading-relaxed">
      <span className="mt-0.5 w-4 h-4 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center flex-shrink-0">
        <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
      <section className="relative overflow-hidden bg-navy-900 border-b border-slate-800 pt-20 pb-20 px-4 text-center">
        <div
          className="absolute inset-0 pointer-events-none"
          aria-hidden="true"
          style={{
            background:
              "radial-gradient(ellipse 60% 80% at 50% 120%, rgba(13,148,136,0.13) 0%, transparent 65%)",
          }}
        />
        <div className="relative max-w-2xl mx-auto">
          <p className="text-xs font-bold text-teal-400 uppercase tracking-widest mb-4">Security</p>
          <h1 className="text-4xl font-bold text-white mb-4">Security at SecureLogic AI</h1>
          <p className="text-lg text-slate-400 leading-relaxed mb-8">
            We&apos;re a compliance and risk platform — and we hold ourselves to the same standards
            we help our customers meet. Here&apos;s how we protect your data.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <a className={PRIMARY_CTA} href={PDF_PATH} target="_blank" rel="noopener noreferrer">
              Download Full Security Overview (PDF)
            </a>
            <a className={SECONDARY_CTA} href="mailto:security@securelogicai.com">
              Report a Vulnerability
            </a>
          </div>
        </div>
      </section>

      {/* How we approach security */}
      <section className="py-16 px-4">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-navy-900 mb-4 text-center">
            How we approach security
          </h2>
          <p className="text-slate-700 leading-relaxed max-w-3xl mx-auto text-center mb-12">
            Security is engineered into our platform from the ground up — not bolted on. Every
            feature is designed with confidentiality, integrity, and availability as primary
            requirements. We aim to be transparent about both what we do well and where we&apos;re
            still maturing.
          </p>
          <div className="grid sm:grid-cols-3 gap-6">
            {APPROACH_CARDS.map((card) => (
              <div key={card.title} className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm">
                <h3 className="text-lg font-semibold text-navy-900 mb-3">{card.title}</h3>
                <p className="text-sm text-slate-600 leading-relaxed">{card.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Data protection table */}
      <section className="bg-slate-50 border-y border-slate-200 py-16 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-navy-900 mb-8 text-center">
            Your data, protected at every layer
          </h2>
          <div className="overflow-x-auto">
            <table className="border-collapse w-full border border-slate-200 bg-white text-sm">
              <thead>
                <tr>
                  <th className="bg-slate-50 p-3 text-left font-semibold border-b border-slate-200 text-navy-900 w-1/3">
                    Layer
                  </th>
                  <th className="bg-slate-50 p-3 text-left font-semibold border-b border-slate-200 text-navy-900">
                    Control
                  </th>
                </tr>
              </thead>
              <tbody>
                {DATA_PROTECTION_ROWS.map(([layer, control]) => (
                  <tr key={layer}>
                    <td className="p-3 border-b border-slate-200 font-semibold text-navy-900 align-top">
                      {layer}
                    </td>
                    <td className="p-3 border-b border-slate-200 text-slate-700 align-top">
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
      <section className="py-16 px-4">
        <div className="max-w-5xl mx-auto grid md:grid-cols-2 gap-12">
          <div>
            <h2 className="text-2xl font-bold text-navy-900 mb-6">
              Strong authentication, organizational control
            </h2>
            <ul className="space-y-3">
              {AUTH_ITEMS.map((item) => (
                <CheckItem key={item}>{item}</CheckItem>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="text-2xl font-bold text-navy-900 mb-6">We watch for trouble, in real time</h2>
            <ul className="space-y-3">
              {MONITORING_ITEMS.map((item) => (
                <CheckItem key={item}>{item}</CheckItem>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Subprocessors */}
      <section className="bg-slate-50 border-y border-slate-200 py-16 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-navy-900 mb-4 text-center">
            We work with trusted infrastructure partners
          </h2>
          <p className="text-slate-700 leading-relaxed max-w-3xl mx-auto text-center mb-10">
            The Services rely on a small set of third-party providers selected for their published
            security posture and compliance attestations. Many of our subprocessors maintain SOC 2
            Type II or equivalent certifications.
          </p>
          <ul className="grid sm:grid-cols-2 gap-x-8 gap-y-3 max-w-3xl mx-auto">
            {SUBPROCESSORS.map(([name, desc]) => (
              <li key={name} className="text-sm text-slate-700 leading-relaxed">
                <span className="font-semibold text-navy-900">{name}</span> — {desc}
              </li>
            ))}
          </ul>
          <p className="text-sm text-slate-600 text-center mt-10">
            For the full subprocessor list, see our{" "}
            <Link href="/privacy/" className="text-teal-600 hover:text-teal-700 underline">
              Privacy Policy
            </Link>
            .
          </p>
        </div>
      </section>

      {/* Compliance posture */}
      <section className="py-16 px-4">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-navy-900 mb-4 text-center">
            Where we are, where we&apos;re going
          </h2>
          <p className="text-slate-700 leading-relaxed mb-12">
            SecureLogic AI does not currently hold independent compliance certifications like SOC 2
            Type II or ISO 27001. As an early-stage company, we rely on the compliance posture of
            our underlying providers and the engineering controls we&apos;ve built into the
            platform. We are committed to maturing our compliance posture as the platform and
            customer base grow.
          </p>
          <div className="grid md:grid-cols-2 gap-8">
            <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm">
              <h3 className="text-lg font-semibold text-navy-900 mb-5">Currently in place</h3>
              <ul className="space-y-3">
                {CURRENTLY_IN_PLACE.map((item) => (
                  <CheckItem key={item}>{item}</CheckItem>
                ))}
              </ul>
            </div>
            <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm">
              <h3 className="text-lg font-semibold text-navy-900 mb-5">Planned milestones</h3>
              <ul className="space-y-3 text-sm text-slate-700">
                {PLANNED_MILESTONES.map((item) => (
                  <li key={item} className="flex items-start gap-2.5 leading-relaxed">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-slate-300 flex-shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Responsible disclosure */}
      <section className="bg-slate-50 border-y border-slate-200 py-16 px-4">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-navy-900 mb-4">Found a vulnerability? Tell us.</h2>
          <p className="text-slate-700 leading-relaxed mb-6">
            SecureLogic AI welcomes responsible disclosure of suspected security vulnerabilities. If
            you believe you&apos;ve discovered a vulnerability, please email us with details that
            allow us to reproduce the issue.
          </p>
          <a
            href="mailto:security@securelogicai.com"
            className="inline-block text-xl font-bold text-teal-600 hover:text-teal-700 mb-8"
          >
            security@securelogicai.com
          </a>
          <ul className="space-y-3 max-w-md mx-auto text-left mb-8">
            {DISCLOSURE_COMMITMENTS.map((item) => (
              <CheckItem key={item}>{item}</CheckItem>
            ))}
          </ul>
          <p className="text-sm text-slate-600">
            For our full Responsible Disclosure Policy, see the{" "}
            <a
              href={PDF_PATH}
              target="_blank"
              rel="noopener noreferrer"
              className="text-teal-600 hover:text-teal-700 underline"
            >
              Security Overview PDF
            </a>
            .
          </p>
        </div>
      </section>

      {/* Read the full Security Overview */}
      <section className="py-16 px-4">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-navy-900 mb-4">Read the full Security Overview</h2>
          <p className="text-slate-700 leading-relaxed mb-8">
            For complete details on our security program, architecture, and controls, download our
            full Security Overview document.
          </p>
          <a className={PRIMARY_CTA} href={PDF_PATH} target="_blank" rel="noopener noreferrer">
            Download Security Overview (PDF)
          </a>

          <div className="mt-14 pt-10 border-t border-slate-200">
            <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-5">
              Related documents
            </h3>
            <ul className="space-y-2">
              {RELATED_DOCS.map((doc) => (
                <li key={doc.href}>
                  <Link href={doc.href} className="text-teal-600 hover:text-teal-700 underline">
                    {doc.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-sm text-slate-600 mt-12">
            Questions about our security program? Contact us at{" "}
            <a
              href="mailto:security@securelogicai.com"
              className="text-teal-600 hover:text-teal-700 underline"
            >
              security@securelogicai.com
            </a>
            .
          </p>
          <p className="text-xs text-slate-400 mt-8">
            &copy; 2026 Threat Loom, LLC d/b/a SecureLogic AI. All rights reserved.
          </p>
        </div>
      </section>
    </>
  );
}
