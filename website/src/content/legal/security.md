---
title: Security
slug: security
effectiveDate: "[INSERT DATE]"
lastUpdated: "[INSERT DATE]"
version: "1.0"
description: "Security at SecureLogic AI — how we protect customer data, our architecture, controls, and compliance posture."
pdfPath: "/SecureLogic-AI-Security-Overview-v1.pdf"
pdfLabel: "Download Full Security Overview (PDF)"
---

# Security at SecureLogic AI

We're a compliance and risk platform — and we hold ourselves to the same standards we help our customers meet. Here's how we protect your data.

<div className="cta-row">
  <a className="cta-primary" href="/SecureLogic-AI-Security-Overview-v1.pdf" target="_blank" rel="noopener noreferrer">Download Full Security Overview (PDF)</a>
  <a className="cta-secondary" href="mailto:security@securelogicai.com">Report a Vulnerability</a>
</div>

---

## How we approach security

Security is engineered into our platform from the ground up — not bolted on. Every feature is designed with confidentiality, integrity, and availability as primary requirements. We aim to be transparent about both what we do well and where we're still maturing.

### Built-in by design

Every code change runs through six required security checks before it can reach production. Cross-tenant isolation is tested automatically on every pull request.

### Defense in depth

Multiple security layers protect customer data — from edge-level DDoS protection, through application-layer controls, to database-enforced audit immutability.

### Transparent posture

We tell you what's in place and what isn't. Our full Security Overview includes a Maturity & Roadmap section so you can calibrate expectations.

---

## Your data, protected at every layer

| Layer | Control |
|---|---|
| **In transit** | TLS encryption for all connections including database |
| **At rest** | Infrastructure-provider encryption (Render, Cloudflare R2) |
| **Sensitive fields** | Application-layer AES-256-GCM encryption with separate keys |
| **Passwords** | Argon2id hashing meeting OWASP recommendations |
| **Audit logs** | Database-trigger-enforced immutability |
| **AI processing** | No customer content used for AI model training, ours or providers' |

---

## Strong authentication, organizational control

- Multi-Factor Authentication (TOTP) supported for all accounts
- Organization-level MFA enforcement for administrators
- Argon2id password hashing with reuse prevention
- Account lockout after 5 failed login attempts
- SAML-based Single Sign-On (SSO) for enterprise customers
- API keys are hashed at rest, revocable at any time, with optional expiration

---

## We watch for trouble, in real time

- 90+ event types tracked in immutable security audit logs
- Automated anomaly detection for credential stuffing and API key probing
- Real-time operator alerts via secure webhook for security-relevant events
- Application error monitoring via Sentry with sensitive data redacted before transmission

---

## We work with trusted infrastructure partners

The Services rely on a small set of third-party providers selected for their published security posture and compliance attestations. Many of our subprocessors maintain SOC 2 Type II or equivalent certifications.

- **Render** — application hosting and managed databases
- **Cloudflare** — content delivery, DDoS protection, object storage
- **Stripe** — payment processing (PCI DSS Level 1)
- **Anthropic** — large language model AI services
- **OpenAI** — speech-to-text transcription
- **Sentry** — application error monitoring
- **Resend** — transactional email delivery

For the full subprocessor list, see our [Privacy Policy](/privacy/).

---

## Where we are, where we're going

SecureLogic AI does not currently hold independent compliance certifications like SOC 2 Type II or ISO 27001. As an early-stage company, we rely on the compliance posture of our underlying providers and the engineering controls we've built into the platform. We are committed to maturing our compliance posture as the platform and customer base grow.

### Currently in place

- Multi-layer encryption (in transit, at rest, application-layer)
- Immutable security audit logs
- Multi-Factor Authentication and SSO support
- Automated security testing on every code change
- Anomaly detection and real-time operator alerting

### Planned milestones

- Independent third-party penetration testing
- SOC 2 Type II attestation
- Documented Incident Response runbook
- Published Business Continuity and Disaster Recovery objectives
- Bug bounty program

---

## Found a vulnerability? Tell us.

SecureLogic AI welcomes responsible disclosure of suspected security vulnerabilities. If you believe you've discovered a vulnerability, please email us with details that allow us to reproduce the issue.

**security@securelogicai.com**

What we commit to:

- Acknowledge your report within 5 business days
- Provide a substantive response within 30 days
- Credit researchers who report responsibly (with permission)

For our full Responsible Disclosure Policy, see the [Security Overview PDF](/SecureLogic-AI-Security-Overview-v1.pdf).

---

## Read the full Security Overview

For complete details on our security program, architecture, and controls, download our full Security Overview document.

<div className="cta-row">
  <a className="cta-primary" href="/SecureLogic-AI-Security-Overview-v1.pdf" target="_blank" rel="noopener noreferrer">Download Security Overview (PDF)</a>
</div>

### Related documents

- [Terms of Service](/terms/)
- [Privacy Policy](/privacy/)
- [AI Transparency & Responsible Use Policy](/ai-policy/)

---

Questions about our security program? Contact us at **security@securelogicai.com**.

---

*© 2026 Threat Loom, LLC d/b/a SecureLogic AI. All rights reserved.*
