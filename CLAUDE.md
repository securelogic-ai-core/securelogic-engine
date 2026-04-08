# CLAUDE.md — SecureLogic Operating Context

Read this file at the start of every session.
This is the authoritative operating context for all SecureLogic development work.

For UI work, also read: `SECURELOGIC_UI_BRIEF.md`

---

## What SecureLogic Is

SecureLogic AI is an enterprise-grade risk intelligence and governance platform built around a core analytical engine, expanded through services that run on top of that engine.

It is not an MVP toy, not a generic chatbot wrapper, and not a newsletter-only business.
It is being built as a production platform for monetization, enterprise trust, and long-term scale.

SecureLogic is a unified platform that enables organizations to identify, assess, monitor, and act on risk across vendors, AI systems, compliance requirements, and external intelligence signals — continuously.

The platform combines:
- Enterprise SaaS capabilities
- Intelligence products (briefs, alerts, reports)
- API-based risk intelligence services

---

## Core Principle

**SecureLogic is an engine-first platform, not a frontend-first product.**

The SecureLogic Engine is the center of the system — the decision-making and scoring layer that transforms raw data into explainable, repeatable, actionable risk insight.

All major platform capabilities should either:
- be implemented inside the engine
- consume engine outputs
- enrich engine inputs
- operationalize engine decisions for users

Do not treat individual services as independent businesses detached from the engine.
Do not treat the newsletter as the platform.
Do not act like the full SaaS platform already exists.

---

## Platform Architecture

Four major layers, in order of dependency:

\`\`\`
1. SecureLogic Engine        — Core analytical brain (risk scoring, framework mapping, findings)
2. Intelligence Layer        — External signal monitoring and processing
3. Supporting Services       — Workers, newsletter, report generator, API layer
4. SaaS Platform (UI)        — User-facing interface and workflows
\`\`\`

The UI is Layer 4. It consumes outputs from the layers beneath it.
It must not replace or replicate logic that belongs in those layers.

Every new service should reinforce the platform, not fragment it.
Do not duplicate core logic across services.
Build shared platform primitives where appropriate.

---

## Two Truths to Hold Simultaneously

1. The SaaS platform is the primary long-term product and revenue engine.
2. The immediate build path is engine-first, then engine-powered services, with the Intelligence Brief as the first developed service.

Do not collapse one into the other.

---

## Current Build Status

### Core SecureLogic Engine
**Status: Partially built — strong foundation.**

Completed:
- Node.js + TypeScript API
- Risk scoring engine (V1 + V2)
- Redis integration for rate limiting and usage caps
- API structure and routing
- Health checks and environment validation

Remaining / required:
- Organization-based data model enforcement
- Entitlement system (free vs paid vs enterprise)
- API key management system
- Full audit logging
- Multi-tenant isolation
- Token-based authentication (JWT/session)
- Org → user → entitlement mapping
- Secure API gateway layer
- Production-grade observability

### Intelligence Engine
**Status: Built and functional.**

Completed:
- Signal ingestion (news, regulatory, AI, security)
- Signal scoring (impact, novelty, relevance)
- Insight generation
- Structured outputs (JSON, HTML, Markdown)

Remaining / required:
- Signal source expansion
- Signal deduplication logic
- Confidence scoring
- Advanced prioritization tuning
- Feedback loop / learning system
- Relevance tuning per organization
- SaaS dashboard integration

### Intelligence Worker
**Status: Built — early production.**

Completed:
- Scheduled execution (cron / GitHub Actions)
- Signal processing pipeline
- Newsletter generation
- Storage using SQLite

Remaining / required:
- Migration to production database (Postgres)
- Job monitoring and retries
- Failure handling
- Scalable queue system
- Multi-tenant processing
- Real-time processing capability
- Observability and logs
- Worker scaling architecture

### Intelligence Brief / Newsletter Service
**Status: Built at functional level — not complete.**

Completed:
- Newsletter generation
- API delivery (\`/intelligence/latest\`)
- Section-based outputs
- Basic subscriber gating

Remaining / required:
- Stripe subscription lifecycle
- Tier-based content access
- Analytics (opens, engagement)
- SaaS platform integration
- Alerting system beyond newsletter only
- Personalization by organization

### Monetization System
**Status: In progress.**

Completed:
- Basic subscriber table
- API gating

Remaining / required:
- Stripe checkout
- Webhook handling
- Subscription lifecycle
- Billing tiers
- Usage-based pricing (future)
- Enterprise contract support

### SaaS Platform Layer
**Status: Not yet built.**

Required:
- Authentication system
- Organization system
- User roles and permissions
- Dashboard UI
- Assessment workflows
- Full frontend portal
- Persistence layer
- Integration with engine
- Enterprise-grade UX

### Vendor Risk Module
**Status: Not yet built.**

Required:
- Vendor database model
- Vendor onboarding workflow
- Assessment intake forms
- Risk scoring integration
- Vendor dashboard
- Continuous monitoring integration
- Document ingestion (SOC2, ISO)
- Automated findings extraction
- Risk trend tracking
- Reporting and exports

### AI Governance Module
**Status: Not yet built.**

Required:
- AI system inventory
- Governance assessment framework
- Policy mapping (ISO 42001, internal)
- Risk scoring
- AI risk questionnaires
- Model risk classification
- Compliance tracking
- Reporting layer

### Compliance Module
**Status: Not yet built.**

Required:
- Framework registry (SOC2, NIST, ISO)
- Control mapping engine
- Gap analysis engine
- Evidence tracking
- Audit-ready reporting
- Continuous compliance monitoring

---

## Current State Summary

**Completed or substantially built:**
- Core scoring engine foundation
- Intelligence pipeline (signals → insights)
- Intelligence worker execution path
- Intelligence brief generation and API delivery
- Basic gating and usage-control foundation

**In progress:**
- Monetization infrastructure (Stripe integration)

**Not yet built:**
- Organization and user system
- Full SaaS platform UI
- Advanced entitlements
- Editorial workflows
- Analytics and reporting dashboards
- Vendor Risk, AI Governance, and Compliance modules

---

## Tech Stack

- **Backend**: Node.js, TypeScript
- **Caching / Rate Limiting**: Redis
- **Database**: SQLite (current) → Postgres (target)
- **Scheduling**: Cron / GitHub Actions
- **Payments**: Stripe (in progress)
- **Deployment**: Render
- **Source Control**: GitHub
- **Security**: Cloudflare Zero Trust (admin access), API key and entitlement validation, rate limiting, structured logging, secret rotation

Do not assume optional infrastructure is fully implemented unless it exists in code or deployment configuration.

---

## Core Data Entities

Organizations, Users, Vendors, Assessments, Findings, Reports, Signals, Insights, Newsletter Issues, Subscribers / Entitlements / Billing State

---

## Monetization Strategy

SecureLogic generates revenue through three primary channels:
1. SaaS subscriptions (core platform — primary revenue)
2. Intelligence products (newsletter, reports)
3. API-based access to risk intelligence services

Every meaningful feature should strengthen at least one of these.

---

## Security Architecture Principles

- Strong authentication
- API key and entitlement validation
- Rate limiting and abuse protection
- Structured logging and monitoring
- Secret management and rotation
- Admin access controls
- Clear tenant isolation boundaries
- Auditable actions

---

## Primary Users (Long-Term)

- Enterprise risk leaders
- Compliance leaders
- Security and governance teams
- Internal analysts
- Executives consuming decision-ready risk reporting

---

## Immediate Execution Emphasis

The immediate priority is:
1. Harden the core engine
2. Complete Stripe and entitlement plumbing (this is the monetization unlock)
3. Make the Intelligence Brief delivery path production-grade
4. Build shared platform primitives that future modules will reuse
5. Avoid architectural decisions that trap the product as a newsletter-only business

Do not start the SaaS UI layer until the service it surfaces is solid underneath.

---

## Priority Lens for Decision-Making

When choosing what to build or how to implement something, prioritize work that improves one or more of:

1. Production reliability
2. Security and tenant safety
3. Monetization readiness
4. Engine reuse across services
5. Platform-enabling architecture
6. Delivery of the first service without architectural drift

---

## UI Build Order (When UI Work Begins)

Work in this sequence. Do not skip ahead.

1. Design system foundations (Button, Input, Card, Table, Badge, Status Pill, Empty State, Loading State, etc.)
2. Authenticated app shell (sidebar, header, org switcher placeholder, user menu, notification area, breadcrumb)
3. Main dashboard shell (explicit live / mocked / unavailable state distinction)
4. Intelligence Brief screens (list, detail reader, archive — first real service experience)
5. Billing and subscription screens (tolerant of Stripe being incomplete)
6. Organization and user settings scaffolding (TypeScript interfaces defined even if backend not ready)
7. Module shells for Vendor Risk, AI Governance, Compliance (structure and empty states only — no fake workflow logic)

### Module Shell Rules
Vendor Risk, AI Governance, and Compliance are not yet built.
When building screens for these modules:
- Use explicit empty states (e.g., "Vendor Risk module not yet connected")
- Do not create assessment workflow logic
- Do not create fake scoring or findings data beyond clearly labeled mock shapes
- Build navigation and screen structure only

### Screen State Requirements
Every screen must support these states where applicable:
- Loading
- Empty
- Error
- Success
- Locked / gated (subscription tier)
- Unavailable / not yet connected (module not built)

"Not yet built" is a product state, not an error state.

### TypeScript Interface Contracts (Define Before Building Screens)
\`\`\`
BriefIssue, BriefSection, Signal, Insight, SubscriptionStatus,
Plan, Organization, User, VendorSummary, GovernanceSystemSummary,
ComplianceFrameworkSummary
\`\`\`

### Information Architecture
Left sidebar + top header.

- Dashboard (Overview, Recent Activity, Key Metrics, Alerts)
- Intelligence (Latest Brief, Archive, Signals, Insights)
- Vendor Risk (Overview, Vendors, Assessments, Findings, Monitoring)
- AI Governance (Overview, AI Systems, Assessments, Policies, Findings)
- Compliance (Overview, Frameworks, Controls, Gaps, Evidence)
- Reports (Generated Reports, Exports, Templates)
- Billing (Plan, Usage, Invoices, Subscription)
- Settings (Organization, Users, Roles, API Access, Profile)

### Visual Design Direction
Enterprise-grade. Clean. Modern. High trust. Analytical.
Not flashy. Not consumer-social.
Prioritize readability, hierarchy, and data clarity.
Tables and data views must be excellent.
Support long-form analytical content and dashboard scanning.

---

## Engineering Rules

When working in this repository:
- Do not make broad uncontrolled changes
- Always propose a plan before editing
- Keep changes tightly scoped
- Preserve production architecture
- Prefer minimal safe fixes over sweeping rewrites
- Call out risks, tech debt, and architectural mismatches explicitly
- When unclear, infer from existing architecture rather than inventing new direction
- Do not invent product direction that contradicts this brief
- Do not treat incomplete modules as complete
- Do not convert a platform architecture into a one-off app
- Do not create duplicate business logic that should live in the engine
- Do not silently introduce new frameworks or dependencies without justification
- Do not use placeholder logic in production code paths
- Do not insert fake data into production code paths
- Do not commit or push unless explicitly told to do so

---

## How to Behave When Coding

**Before making any changes:**
1. Read this file
2. Identify the relevant architectural layer
3. Determine whether the change belongs in the core engine, a service, or shared platform infrastructure
4. Explain the smallest safe implementation path
5. List the files likely to change
6. Show diffs before commit — wait for approval before editing

**While coding:**
- Preserve existing architecture unless there is a clear defect
- Favor explicitness over cleverness
- Build reusable platform primitives where appropriate
- Avoid one-off service logic that should be shared
- Keep monetization and enterprise-readiness in view
- Surface tradeoffs honestly

---

## What to Inspect First Before Changing Anything

- Repository entry points
- Server / app startup flow
- Engine boundaries
- Service boundaries
- Deployment configuration
- Environment variables
- Tests and validation commands
- Persistence choices
- Auth and entitlement flow
- Multi-tenant assumptions
- Current architectural constraints

---

## Source-of-Truth Rule

If repository code and this brief conflict, do not blindly trust either one.
Instead:
1. Identify the conflict explicitly
2. Explain whether the repo appears behind the intended architecture, or whether this brief appears stale
3. Recommend the safest next step

---

## How to Answer Architecture Questions

When asked what to build next or how something should be implemented:
- Anchor recommendations in this brief
- Distinguish between current build phase and long-term platform vision
- Prefer shared infrastructure over isolated features
- Explain how the recommendation supports monetization, enterprise trust, or scale

---

## Output Expectations

- Explain reasoning clearly
- Show files to be changed before editing
- Show diffs before commit
- Distinguish current reality from future vision
- Call out when code does not match the intended architecture
- State assumptions explicitly
- Do not claim a module exists unless it is actually present in the repo
- Do not commit or push unless explicitly told

---

## Non-Goals

- Do not reduce SecureLogic to a generic content or newsletter operation
- Do not treat the newsletter as the whole product
- Do not build throwaway MVP-grade code in core paths
- Do not prioritize flashy UI over core platform integrity
- Do not create service-specific workarounds that undermine the future platform

---

## Session Start Behavior

At the beginning of any meaningful coding session:

1. Read this file
2. Walk the repository structure and summarize every directory and its purpose
3. For each item in the "Current Build Status" section above, confirm whether it exists in the repo, is partially present, or is absent
4. Identify any code that exists in the repo but is NOT accounted for in this brief
5. Identify any architectural drift — places where the repo diverges from the intended architecture
6. Identify the top risks or gaps relevant to the requested task
7. Confirm whether the task belongs to the engine, a service, or shared platform infrastructure
8. Do not edit anything until a plan has been proposed and approved

## Brand Source of Truth

This section is the authoritative brand reference for SecureLogic AI.
If any existing UI, templates, docs, or code conflict with this section, this section wins unless explicitly overridden by the user.

### Brand name
SecureLogic AI

### Brand architecture
- SecureLogic AI is the master brand
- The Intelligence Brief is a product/service under SecureLogic AI
- Do not treat "SecureLogic Intelligence" as the primary standalone brand name
- Do not create alternate brand naming without explicit approval

### Brand positioning
SecureLogic AI is a Unified Risk Intelligence Platform that helps organizations see, understand, and act on their total risk exposure across vendors, controls, compliance frameworks, and AI systems.

### Visual identity
- Use the attached SecureLogic AI logo as the primary logo asset
- Font family: Inter
- Primary brand palette must be derived from the official SecureLogic AI logo
- Replace any placeholder branding assumptions such as indigo/slate if they appear in prior files or UI code

### Color guidance
Use these semantic brand references unless exact hex values are later provided by the user:
- Primary Teal: derived from the logo teal
- Primary Navy: derived from the logo navy
- Backgrounds: clean white or very light neutral by default for marketing surfaces
- Dark surfaces: may use navy-based dark tones if needed, but only if they remain consistent with the official logo and overall brand feel

Do not continue using the previous placeholder palette:
- indigo
- slate-900
unless explicitly approved for a specific component or dark-mode treatment

### Brand feel
The UI and branded outputs should feel:
- enterprise-grade
- clean
- modern
- high-trust
- analytical
- professional
- not flashy
- not consumer-social

### Intelligence Brief branding rules
- The Intelligence Brief must be branded as a SecureLogic AI product
- Newsletter headers, footers, issue pages, and related templates must reflect SecureLogic AI branding
- Do not present the Intelligence Brief as a separate company or separate master brand
- Product naming may reference "Intelligence Brief" prominently, but parent branding must remain SecureLogic AI

### Logo usage rules
- Prefer the official SecureLogic AI logo asset where logo display is appropriate
- Do not invent substitute logos, icons, or wordmarks unless explicitly requested
- If a logo asset path is needed in the repo, propose the path first and wait for approval before broad implementation

### Implementation rules
Before making branding-related code changes:
1. inspect the current branding references in docs, templates, and UI
2. identify stale or conflicting branding assumptions
3. propose the exact files to update
4. update source-of-truth guidance files first
5. only then update UI/templates/components

### Conflict rule
If older files reference:
- SecureLogic Intelligence as the main brand
- indigo/slate placeholder colors
- non-approved logo assumptions
treat those references as stale and propose corrections before continuing