# SecureLogic AI - Claude Operating Brief

## What this product is
SecureLogic AI is an enterprise-grade risk intelligence and governance platform.
It is built around a core analytical engine and expanded through services that run on top of that engine.
It is not an MVP toy, not a generic chatbot wrapper, and not a newsletter-only business.
It is being built as a production platform for monetization, enterprise trust, and long-term scale.

## Product vision
SecureLogic is a unified platform that enables organizations to identify, assess, monitor, and act on risk across vendors, AI systems, compliance requirements, and external intelligence signals on a continuous basis.

The platform combines:
- enterprise SaaS capabilities
- intelligence products
- API-based risk intelligence services

The long-term platform has four major layers:
1. SecureLogic Engine (core analytical brain)
2. SaaS Platform (user interface, workflows, dashboards)
3. Intelligence Layer (external monitoring and signal processing)
4. Delivery Layer (reports, APIs, newsletters, alerts)

## Core principle
The SecureLogic Engine is the center of the system.
It is the decision-making and scoring layer that transforms raw data into explainable, repeatable, actionable risk insight.

All major platform capabilities should either:
- be implemented inside the engine,
- consume engine outputs,
- enrich engine inputs, or
- operationalize engine decisions for users.

Do not treat individual services as independent businesses detached from the engine.

## Current execution reality
SecureLogic is being built in phases.

The current model is:
1. Build and harden the core engine
2. Build services on top of the core engine
3. Use those services to prove distribution, monetization, and operational workflows
4. Evolve toward the full SaaS platform

The first service currently being developed on top of the engine is the newsletter / intelligence brief service.
This service is important, but it is not the whole business.
It is the first operational service layer built on top of the core engine.

## Strategic truth vs current build path
Two truths must be held at the same time:

1. The SaaS platform is the primary long-term product and revenue engine.
2. The immediate build path is engine-first, then engine-powered services, with the newsletter/intelligence brief as the first developed service.

Do not collapse one into the other.
Do not act like the newsletter is the platform.
Do not act like the full SaaS platform already exists.

## Core goal
Help organizations assess, score, monitor, and report risk in a decision-ready format across:
- vendor risk
- AI governance risk
- compliance risk
- security and external intelligence developments

## What the engine does
The SecureLogic Engine is responsible for:
- risk scoring and prioritization
- framework mapping
- vendor risk analysis
- compliance evaluation
- signal-to-insight transformation
- explainable and repeatable decision logic

Framework coverage may include areas such as:
- SOC 2
- NIST
- ISO
- AI governance frameworks

## Long-term platform modules
The broader SecureLogic platform is intended to include:
- Vendor Risk Management module
- AI Governance module
- Compliance module
- Intelligence monitoring and alerts
- Reporting and report generation
- Dashboard and analytics layer
- API access layer
- Admin and billing systems
- Organization and user management

## Core architecture principle
SecureLogic has a platform architecture, but execution should remain modular.

Use this hierarchy:
- Core engine first
- Services built on top of the engine second
- Shared platform capabilities underneath all services
- Full SaaS user experience layered on top as the product matures

Every new service should reinforce the platform, not fragment it.

## Supporting services
Supporting services built on top of the engine include:
- Intelligence Worker
- Newsletter / Intelligence Brief system
- Report Generator
- Future Admin Console
- API Access Layer

These services should share common platform primitives wherever possible.
Do not duplicate core logic across services.

## Newsletter / Intelligence Brief service
The newsletter / intelligence brief is a delivery service powered by the intelligence layer and the core engine.
It exists to distribute curated intelligence outputs.

It is not the platform itself.
It is one output and one channel.

It should be treated as:
- a service built on top of the engine
- a monetizable intelligence product
- a proving ground for entitlement, billing, distribution, content gating, and intelligence delivery
- a feeder into future dashboards, alerts, research reports, and API-delivered intelligence

## Product principles
- Enterprise-grade, not prototype-grade
- Production-safe changes only
- Clear auditability and explainability
- Strong auth, entitlements, usage controls, and reliability
- Minimize unnecessary complexity
- Every feature should support monetization, enterprise trust, or operational scale
- Reuse shared platform capabilities instead of building one-off logic
- Preserve architectural integrity across services
- Prefer durable systems over quick hacks

## Current technical stack
- Node.js + TypeScript API foundation
- GitHub for source control
- Render for deployment
- Redis for rate limiting and usage caps
- SQLite currently used in the intelligence worker layer
- Postgres expected for production-grade persistence
- ChatGPT used for architecture, planning, review, and coding support
- Claude Code used for repo-level implementation and debugging

## Current build status
### Core SecureLogic Engine
Status: partially built with a strong foundation.

Completed:
- Node.js + TypeScript API
- Risk scoring engine (V1 + V2)
- Redis integration for rate limiting and usage caps
- API structure and routing
- Health checks and environment validation

Remaining / required:
- organization-based data model enforcement
- entitlement system (free vs paid vs enterprise)
- API key management system
- full audit logging
- multi-tenant isolation
- token-based authentication (JWT/session)
- org -> user -> entitlement mapping
- secure API gateway layer
- production-grade observability

### Intelligence Engine
Status: built and functional.

Completed:
- signal ingestion
- signal scoring (impact, novelty, relevance)
- insight generation
- structured outputs (JSON, HTML, Markdown)

Remaining / required:
- source expansion
- signal deduplication logic
- confidence scoring
- advanced prioritization tuning
- feedback loop / learning system
- relevance tuning per organization
- SaaS dashboard integration

### Intelligence Worker
Status: built and early production.

Completed:
- scheduled execution (cron / GitHub Actions)
- signal processing pipeline
- newsletter generation
- storage using SQLite

Remaining / required:
- migration to production database (Postgres)
- job monitoring and retries
- failure handling
- scalable queue system
- multi-tenant processing
- real-time processing capability
- observability and logs
- worker scaling architecture

### Intelligence Brief / Newsletter Service
Status: built at a functional level, but not complete.

Completed:
- newsletter generation
- API delivery
- section-based outputs
- basic subscriber gating

Remaining / required:
- Stripe subscription lifecycle
- tier-based content access
- analytics (opens, engagement)
- SaaS platform integration
- alerting system beyond newsletter only
- personalization by organization

### SaaS Platform Layer
Status: not yet built.

Required components:
- authentication system
- organization system
- user roles and permissions
- dashboard UI
- assessment workflows
- frontend portal
- persistence layer
- integration with engine
- enterprise-grade UX

### Vendor Risk Module
Status: not yet built.

Required components:
- vendor database model
- vendor onboarding workflow
- assessment intake forms
- risk scoring integration
- vendor dashboard
- continuous monitoring integration
- document ingestion
- automated findings extraction
- risk trend tracking
- reporting and exports

### AI Governance Module
Status: not yet built.

Required components:
- AI system inventory
- governance assessment framework
- policy mapping
- risk scoring
- AI risk questionnaires
- model risk classification
- compliance tracking
- reporting layer

### Compliance Module
Status: not yet built.

Required components:
- framework registry
- control mapping engine
- gap analysis engine
- evidence tracking
- audit-ready reporting
- continuous compliance monitoring

### Monetization System
Status: in progress.

Completed:
- basic subscriber table
- API gating

Remaining / required:
- Stripe checkout
- webhook handling
- subscription lifecycle
- billing tiers
- usage-based pricing in the future
- enterprise contract support

## Current state summary
Completed or substantially built:
- secure scoring engine foundation
- intelligence pipeline from signals to insights
- intelligence worker execution path
- intelligence brief generation and API delivery
- basic gating and usage-control foundation

In progress:
- monetization infrastructure, especially Stripe integration

Not yet built:
- organization and user system
- full SaaS platform interface
- advanced entitlements
- editorial workflows
- analytics and reporting dashboards
- major business modules such as vendor risk, AI governance, and compliance

## Primary users
Long-term primary users may include:
- enterprise risk leaders
- compliance leaders
- security and governance teams
- internal analysts
- executives consuming decision-ready risk reporting

## Core data entities
Core entities may include:
- Organizations
- Users
- Vendors
- Assessments
- Findings
- Reports
- Signals
- Insights
- Newsletter Issues
- Subscribers / entitlements / billing state

## Security architecture principles
The platform should use a layered security model, including:
- strong authentication
- API key and entitlement validation
- rate limiting and abuse protection
- structured logging and monitoring
- secret management and rotation
- admin access controls
- clear tenant isolation boundaries
- auditable actions

Possible infrastructure/security components may include things like Cloudflare Zero Trust for admin access, but do not assume optional infrastructure is fully implemented unless it exists in code or deployment configuration.

## Monetization strategy
SecureLogic is expected to generate revenue through three major channels:
1. SaaS subscriptions for the core platform
2. Intelligence products such as newsletters and reports
3. API-based access to risk intelligence services

Every meaningful feature should strengthen at least one of these.

## Engineering rules for Claude
When helping in this repository:
- Do not make broad uncontrolled changes
- Always propose a plan before editing
- Keep changes tightly scoped
- Preserve production architecture
- Prefer minimal safe fixes over sweeping rewrites
- Call out risks, tech debt, and architectural mismatches explicitly
- When unclear, infer from existing architecture rather than inventing a new direction
- Do not invent product direction that contradicts this brief
- Do not treat incomplete modules as complete
- Do not convert a platform architecture into a one-off app
- Do not create duplicate business logic that should live in the engine
- Do not silently introduce new frameworks or dependencies without justification
- Do not use placeholder logic in production paths
- Do not insert fake data into production code paths
- Do not commit or push unless explicitly told to do so

## How to behave when coding
Before making changes:
1. Read this file first
2. Identify the relevant architectural layer
3. Determine whether the change belongs in the core engine, a service built on top of the engine, or shared platform infrastructure
4. Explain the smallest safe implementation path
5. List the files likely to change
6. Show diffs before commit

When coding:
- preserve existing architecture unless there is a clear defect
- favor explicitness over cleverness
- build reusable platform primitives where appropriate
- avoid one-off service logic that should be shared
- keep monetization and enterprise-readiness in view
- surface tradeoffs honestly

## What to inspect first before changing anything
- repository entry points
- server/app startup flow
- engine boundaries
- service boundaries
- deployment configuration
- environment variables
- tests and validation commands
- persistence choices
- auth and entitlement flow
- multi-tenant assumptions
- current architectural constraints

## Output expectations
- Explain reasoning clearly
- Show files to be changed before editing
- Show diffs before commit
- Distinguish current reality from future vision
- Call out when code does not match the intended architecture
- State assumptions explicitly
- Do not claim a module exists unless it is actually present
- Do not commit or push unless explicitly told

## Priority lens for decision-making
When choosing what to do next, prioritize work that most improves one or more of the following:
1. production reliability
2. security and tenant safety
3. monetization readiness
4. engine reuse across services
5. platform-enabling architecture
6. delivery of the first service without architectural drift

## Immediate execution emphasis
The immediate emphasis is not to pretend the entire SaaS platform is already being built at once.

The immediate emphasis is:
- harden the core engine
- support the first service built on top of it
- complete the necessary monetization and entitlement plumbing
- build shared platform primitives that future modules will reuse
- avoid architectural decisions that trap the product as a newsletter-only business

## Non-goals
- Do not reduce SecureLogic to a generic content/newsletter operation
- Do not treat the newsletter as the whole product
- Do not build throwaway MVP-grade code in core paths
- Do not prioritize flashy UI over core platform integrity
- Do not create service-specific workarounds that undermine the future platform

## How to answer architecture questions
When asked what to build next or how something should be implemented:
- anchor recommendations in this brief
- distinguish between current build phase and long-term platform vision
- prefer shared infrastructure over isolated features
- explain how the recommendation supports monetization, enterprise trust, or scale

## Source-of-truth rule
If repository code and this brief conflict, do not blindly trust either one.
Instead:
1. identify the conflict explicitly
2. explain whether the repo appears behind the intended architecture or whether the brief appears stale
3. recommend the safest next step

## Session start behavior
At the beginning of any meaningful coding session:
- read this file
- summarize the current architecture as understood from the repo
- identify what is already built vs missing
- identify the top risks or gaps relevant to the requested task
- confirm whether the task belongs to the engine, a service, or shared platform infrastructure
