# SecureLogic AI — Four-Pillar Build Roadmap

**Goal:** Make the product genuinely deliver what the positioning promises — a cyber risk
intelligence platform with four real pillars (Vendor Risk, Compliance/GRC, AI Governance,
Cyber Intelligence) built around the Intelligence Brief wedge — then price the whole thing
correctly.

**Decision on record:** Hold launch. Build all four pillars to match the pitch before going live.
Pricing finalization deferred until services are locked.

## The strategy in one paragraph

You are not competing head-to-head with Recorded Future, SecurityScorecard, Black Kite,
or Vanta — they are large, single-lane, data-moat companies. Your defensible position is the
integrated loop: take a threat/regulatory signal, explain it and say what to do, and connect it
to the customer's own vendors, controls, and AI systems — for a small security team that
can't staff an analyst or afford three separate tools. Your edge is integration + prescription
+ simplicity, not data scale. This roadmap builds the four pillars up to the point where that
promise is true end-to-end, in the order that finishes real things fastest and keeps a launch
option open at every step.

## Sequencing principle

Build smallest-effort-to-real first. This finishes pillars (momentum), and means that after
each step you are more shippable than before — so if you ever decide to launch early, you
can, at a clean boundary. The order is deliberate: Vendor Risk (days) → Compliance/GRC
(weeks) → AI Governance (weeks + design) → Cyber Intelligence (largest).

A cross-cutting rule runs through all four: as you finish each pillar, make sure its
entitlement gate is correct. You are not setting final prices yet, but the current code
accidentally unlocks the whole platform at the $39 tier. Build the rooms, but verify the locks
work before you furnish them — handled per-pillar below, not as a separate pricing project.

## PILLAR 1 — Vendor / Third-Party Risk

**Current state:** Shipped (core). Your second-strongest pillar. Real scoring, immutable
assessments, mutable review workflow, Claude SOC-doc extraction, PDF/XLSX/CSV export,
45+ working screens, real tests. **Target state:** Fully real and fully usable in production,
including the differentiated SOC-document feature. **Effort:** Days. This is the fastest path to
a finished pillar.

### The immediate freebie (do this first, regardless of the rest)

The SOC assurance-document feature — automatically reading a vendor's SOC report and
mapping controls — is your most differentiated vendor capability, and it is built but
**switched OFF in production** (a feature flag; production returns 404). Turning it on is close
to a flag flip plus verification, not a build. This is value you already paid to build and are
currently hiding from paying customers.

Tasks:

1. **Investigate the flag (read-only first).** Identify exactly what the staging-only flag
   controls, why it 404s in prod, and what must be true (env var, R2 attachment storage,
   dependencies) for it to work in production. Do not flip anything until the blast radius is
   understood.
2. **Flip it on in production, verified.** Once the investigation confirms it's safe, enable the
   flag in prod, confirm the R2 attachment path works end-to-end (upload → extract →
   map → export), and smoke-test with a real SOC document.
3. **Fill the stubbed pieces.** Three vendor features are schema-present but logic-empty:
   concentration risk, nth-party cascade, inherent/residual split. Decide which actually
   matter for your buyer (concentration risk is the most likely to matter for a small team)
   and build the computation behind it. The tables already exist.
4. **Verify the entitlement gate.** Confirm vendor-risk routes are gated at the tier you intend
   (not accidentally open to the free tier through the back door).

### Pillar 1 "done" definition

A paying customer can add vendors, get a real risk score, upload a SOC report and have it
auto-analyzed in production, see concentration risk, and export. No stub presented as a
feature.

## PILLAR 2 — Compliance / GRC

**Current state:** Partial. The posture-scoring engine underneath is mature and strong
(domain aggregation, context weighting, daily snapshots) — this is a hidden asset. But the
customer-facing workflow around it is thin. **Target state:** A customer can actually walk
through assessing a framework, upload evidence, and see their gaps — backed by the
strong engine that already exists. **Effort:** Weeks. This is front-end + wiring, not invention —
the backend is largely ready.

Tasks:

1. **Build the guided "assess this framework" walkthrough UI.** The backend is ready; the
   front-end workflow that takes a user through a framework assessment step by step is
   missing. This is the single biggest gap between "has a compliance engine" and "sells
   compliance."
2. **Add real evidence file upload.** Today evidence is metadata-only (no file upload, except
   the vendor-assurance R2 path). Reuse that same R2 attachment mechanism from Pillar
   1 so a customer can attach actual evidence documents to controls.
3. **Surface the gap views.** The gap-report and posture data exist; make sure the customer
   can see, in plain screens, where they fall short and what closes the gap.
4. **Decide on live frameworks.** Frameworks are currently static seed data flagged OFF in
   production. Decide whether you ship a fixed set of well-maintained frameworks (simpler,
   honest) or invest in a live regulatory feed (much larger). For launch credibility, a curated
   fixed set that's actually turned on beats a "live feed" that isn't built.
5. **Verify the entitlement gate** and resolve the UI/API mismatch — today the API gates the
   platform at rank-2 while the app redirects non-premium users from the posture page.
   Pick one and make them agree.

### Pillar 2 "done" definition

A customer can pick a framework, walk through assessing it, attach evidence files, and see
a real gap report — all gated consistently.

## PILLAR 3 — AI Governance

**Current state:** Partial. Real AI-system inventory and point-in-time assessment, data-
backed (not a label). But it uses the generic scoring engine — no AI-specific risk logic, no
monitoring, and the vendor→AI dependency link exists in the schema but nothing flows
through it. **Target state:** Genuine AI risk management, not just an AI list. This is where you
can build something the giants don't have. **Effort:** Weeks + design decisions you must make
before any code.

Design decisions required before building (these are yours, not the agent's):

- **Which framework do you tier against?** EU AI Act risk tiers? NIST AI RMF? Both? This
  determines the whole scoring model.
- **What does "connect a vendor problem to the AI systems that depend on it"
  actually mean in your product** — concretely, when a vendor has a CVE or a finding,
  what should happen to the AI systems linked to that vendor? This is your differentiated
  loop; it needs a precise definition.

Tasks (after the design decisions):

1. **Add AI-specific scoring.** Replace generic domain aggregation with scoring that
   accounts for model type, PII exposure, and the framework tier you chose (EU AI Act /
   NIST AI RMF).
2. **Build the dependency cascade.** Make the vendor→AI dependency edges actually do
   something: a vendor CVE or finding should cascade to flag the dependent AI systems.
   This is the integrated-loop promise made real for AI, and nothing the competitors do.
3. **Add basic monitoring/drift if scope allows** — even a simple "this AI system hasn't been
   reassessed in N days, and here's what changed about its vendor" is more than a one-
   time checklist.
4. **Verify the entitlement gate.**

### Pillar 3 "done" definition

A customer can register an AI system, get an AI-specific risk tier (not a generic score), and
see it automatically flagged when a vendor it depends on has a problem.

## PILLAR 4 — Cyber Intelligence (standalone)

**Current state:** Stub / does not exist as a product. The ingestion, dedup, matching, and
finding-creation are all fully built — but purely as plumbing that feeds the Brief. There is no
standalone screen a customer can open. **Target state:** A real, customer-facing intelligence
surface — OR a deliberate decision that this stays as Brief-plumbing and the pitch changes
instead. **Effort:** Largest. Closest to from-scratch as a customer-facing pillar.

**The honest fork (decide before building):** By the time you reach this pillar, you'll have
shipped three real ones and gotten a feel for what customers actually use. You may find that
the Brief already is your cyber-intelligence product, and a separate standalone surface is
effort no one asked for. Two valid outcomes:

- **(A) Build it:** a real feed / threat tracker / campaign monitor with its own screen, drawing
  on the ingestion pipeline that already exists.
- **(B) Drop the claim:** keep cyber-intel as Brief-plumbing and revise the positioning so
  "cyber intelligence" means the Brief, not a separate pillar. This is not a failure — it's
  matching the pitch to a product that's already strong, rather than building a pillar to
  justify a sentence.

Tasks (if you choose A):

1. **Design the standalone surface** — what does a customer do on a cyber-intel screen that
   they can't do from the Brief? (If you can't answer this crisply, that's a strong signal for
   option B.)
2. **Build the screen** on top of the existing ingestion/matching pipeline.
3. **Add whatever makes it standalone-worthy:** searchable feed, saved threats, per-asset
   tracking.
4. **Verify the entitlement gate.**

### Pillar 4 "done" definition

Either a real standalone intelligence surface a customer opens and uses, or a clean
positioning revision that no longer claims a pillar you didn't build.

## Cross-cutting: the pricing layer (do NOT finalize yet, but don't ignore)

You correctly chose to defer final pricing until the services are locked. But two things are
true now and must not be lost:

1. **The entitlement inversion is live.** Today the $39 "Professional" (Brief) tier unlocks
   essentially the entire platform at the API level, while the UI tells those users they're
   locked out. As you finish each pillar, you make this accidental giveaway more valuable.
   Per-pillar rule: when a pillar is done, confirm its routes are gated at the tier you actually
   intend — even if you haven't set the final price, the gate must exist correctly so you're
   not shipping finished pillars into the leak.
2. **Code tiers don't match your commercial docs.** Code ships three effective ranks (free
   → $39 → $209); your governing docs describe five tiers that don't exist in code. When
   you do the pricing pass (after the pillars), reconcile these so the product, the pricing
   page, and the docs all agree.

**When to do the real pricing pass:** after Pillar 2 is done at the latest. By then you'll have a
credible multi-pillar platform and can price it as the real thing — once, correctly — instead of
pricing a half-product you'll have to re-price.

## Suggested order of operations (the working sequence)

1. **Pillar 1, the freebie** — investigate + flip the vendor SOC-document flag on in
   production. Fastest, highest-value-per-effort move. (Days.)
2. **Pillar 1, finish** — build concentration risk + verify gate. (Days.)
3. **Pillar 2** — guided framework assessment UI + evidence upload + gap views + turn
   frameworks on + fix UI/API gate mismatch. (Weeks.)
4. **Pricing pass #1** — reconcile the entitlement gates and tier model now that you have
   two-plus real pillars. (Focused session; the inventory already located the files.)
5. **Pillar 3** — make the AI-specific design decisions, then build AI scoring + vendor→AI
   cascade. (Weeks + decisions.)
6. **Pillar 4** — decide build-vs-drop, then either build the standalone surface or revise the
   pitch. (Largest, or a positioning edit.)
7. **Pricing pass #2 (final)** — price the whole, locked platform correctly. Launch.

## Honest notes to keep in view

- **This is a months-long roadmap, not a weekend.** You chose the cleaner-but-slower
  road (build whole, then launch) over the faster one (launch on strengths, build with
  feedback). That's a legitimate choice — but the cost is real: you're building without user
  feedback telling you which pillars matter most. The sequence above mitigates this by
  finishing real things first and keeping a launch option open at every boundary, in case
  you change your mind.
- **The launch option never fully closes.** After Pillar 1 you're more shippable than today;
  after Pillar 2 you have three solid pillars. If at any boundary you decide friends' feedback
  is worth more than waiting, you can launch on what's real and keep building. Nothing
  here locks you out of that.
- **Pillar 4 may resolve itself into a positioning edit.** Don't assume you must build a
  standalone cyber-intel product. The most likely honest outcome is that the Brief is your
  intelligence product and the pitch gets tightened. Building a pillar purely to justify a
  sentence is the one move in this roadmap to be most skeptical of.
- **The vendor SOC-flag flip is the one thing worth doing immediately, today,**
  regardless of everything else — it's already-built value you're currently hiding from
  paying customers.
