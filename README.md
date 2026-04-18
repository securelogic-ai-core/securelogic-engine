# SecureLogic AI

SecureLogic AI is an enterprise cyber risk intelligence platform that gives organizations a unified view of their security posture, governance, risk, and compliance. The platform covers AI governance, vendor risk management, compliance framework readiness, regulatory obligation tracking, control testing, finding management, and weekly AI-enriched executive intelligence briefs.

## Architecture

Three services compose the platform:

- **Engine API** (`src/`) — Node.js/Express/TypeScript backend. Handles all data persistence, authentication, billing, SSO, PDF generation, and external integrations. Exposes a REST API consumed by the App.
- **App** (`app/`) — Next.js 15/TypeScript customer-facing web application. All engine calls are made server-side; no secrets or API keys are sent to the browser.
- **Intelligence Worker** (`services/intelligence-worker/`) — Long-running async pipeline for signal ingestion, normalization, AI enrichment, and weekly brief generation.

## Tech Stack

| Layer | Technology |
|---|---|
| Engine | Node.js 20, Express 5, TypeScript, PostgreSQL, Redis, PDFKit, samlify |
| App | Next.js 15, TypeScript, Tailwind CSS, iron-session |
| AI | Anthropic Claude SDK (`claude-sonnet-4-6`) |
| Infrastructure | Render (3 services), managed PostgreSQL, managed Redis |
| Payments | Stripe |
| Email | Resend |

## Key Features

- Vendor risk management with AI-assisted assessment
- Compliance framework readiness tracking (SOC 2, NIST CSF, ISO 27001, and custom frameworks)
- AI governance model inventory and review workflow
- Policy register and obligation lifecycle management
- Control testing cadence tracking with evidence collection
- Finding and remediation action management
- Risk register with severity and priority scoring
- Weekly AI-enriched executive intelligence briefs
- Multi-user teams with role-based access control (admin, editor, viewer)
- SAML 2.0 SSO with JIT provisioning
- Customer API access with usage metering
- SOC 2 gap analysis PDF export
- Full audit log with actor attribution and CSV export

## Development Setup

**Prerequisites:** Node.js 20+, PostgreSQL 15+, Redis 7+

```bash
# Install dependencies
npm install
cd app && npm install && cd ..

# Configure environment
cp .env.example .env.local
# Edit .env.local with your local values

# Run database migrations
npm run migrate

# Start services (two terminals)
npm run dev:server       # engine API on :4000
cd app && npm run dev    # Next.js app on :3000
```

## Environment Variables

See `.env.example` for the full list with descriptions. Required for the engine:

- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — HS256 signing secret (min 32 chars)
- `SESSION_SECRET` — iron-session cookie encryption key (min 32 chars)
- `ANTHROPIC_API_KEY` — Claude API key for AI enrichment
- `REDIS_URL` — Redis connection string
- `STRIPE_SECRET_KEY` — Stripe secret key
- `RESEND_API_KEY` — Resend API key for transactional email

See `app/.env.example` for App-specific variables.

## Deployment

All three services are deployed on Render and configured in `render.yaml`. Push to `main` triggers an automatic deploy of all services. The engine runs migrations on startup before accepting traffic.

## Testing

```bash
npx vitest run    # runs the full test suite from the repo root
```
