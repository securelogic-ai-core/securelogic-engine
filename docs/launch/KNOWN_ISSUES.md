# Known Issues & Limitations at Launch

> **Purpose:** An honest, verified catalogue of limitations, technical debt, and intentionally-inert paths at launch. Per `FINAL_PRODUCT_STANDARD.md`, stale or dishonest docs are treated as defects — this list is deliberately candid.
> **Last reconciled:** 2026-07-02 (`develop` `17353bb9`, `main` `959951b9`).
> **Severity key:** 🔴 launch-blocking · 🟠 ship-with-mitigation · 🟡 known-debt (post-launch) · 🟢 cosmetic/orientation.

This file does **not** track CI bugs or transient failures. It tracks structural limitations a customer, auditor, or future engineer must know about.

---

## 🔴 Launch-blocking (tracked in Sprint 1)

These are the only items that hold the **NO-GO**. All are operator-only gates; none is a code defect. Full detail in `SPRINT_1.md`.

| ID | Issue | Owner |
|---|---|---|
| L-1 | Stripe Billing Portal configuration (`STRIPE_PORTAL_CONFIGURATION_ID`) not confirmed on prod engine | Operator |
| L-2 | Stripe test-mode portal capabilities (update/proration/cancel + Price IDs) not validated | Operator |
| L-3 | Staging checkout amounts not confirmed ($49 / $199 / $7,200) | Operator |
| L-4 | Staging portal upgrade/downgrade × 5 transitions (entitlement correctness) not validated | Operator |
| L-5 | 6 staged migrations not validated on staging + prod pre-flight (F-1 + seat-cap) | Operator |

---

## 🟠 Ship-with-mitigation (live at launch, mitigated)

### M-1 — Postgres RLS is INERT pre-flip
- **What:** RLS policies exist on ~22 tables but run under the owner cred with `NOT FORCE` — they do **not** enforce.
- **Live mitigation:** route-level `organization_id` scoping is the live tenant defense, and the `cross-org-isolation` CI lane proves per-org containment of the worker→brief fan-out (R5 resolved). This is the **current production posture** and is acceptable for launch.
- **Resolution:** A04-G1 `app_request` flip → **Sprint 3.1**.

### M-2 — GDPR export ships, but delivery email does not
- **What:** The Art. 15 export path is built and prod-verified, but no delivery email is sent → exports are **inert end-to-end**. A requester receives no link.
- **Mitigation:** the feature is effectively dark; no customer can trigger a broken-looking flow because the intake exists but nothing promises delivery yet.
- **Resolution:** export-delivery email (PR #4, shared `sendEmail()`) → **Sprint 2.1**.

### M-3 — Vendor-assurance prod enablement UNKNOWN-from-repo
- **What:** Pillar-1 extraction worker is shipped + staging-validated behind `SECURELOGIC_VENDOR_ASSURANCE_ENABLED`. Full prod enablement (prod flag + prod R2 + `ANTHROPIC_API_KEY` placement) is an operator/dashboard action **not provable from the repo**.
- **Mitigation:** committed `render.yaml` carries the flag on `securelogic-engine-staging` only; prod behavior is gated off unless the operator has enabled it.
- **Resolution:** confirm + document prod posture → **Sprint 2.3**.

---

## 🟡 Known debt (post-launch)

### D-1 — Vendor route entitlement boundary at rank-2
- `vendorAssessments.ts`, `vendorReviews.ts`, `findings.ts` stay at rank-2 `requireEntitlement("standard")`. UIs redirect rank-2 users, but a direct API-key caller reaches these APIs at rank-2. Deliberate, known boundary. → **Sprint 2.4**.

### D-2 — In-app price labels are stale
- BriefCard, UpgradeCard, and the `/pricing` route carry old prices that contradict the corrected commercial model. Display-label only; Stripe prices/IDs are correct. → **Sprint 2.2**.

### D-3 — GDPR deletion (Art. 17) not built
- Export rights exist; erasure rights do not. Phase-0 design is settled (10 locks; D-9 cleared) but the reaper is unbuilt. → **Sprint 3.2**.

### D-4 — Priority-4 signal ingestion is foundation-only
- Only the additive 4A contract/registry stubs shipped; the scheduler does not yet consume `API_SOURCES`. Source qualification, clustering, and provenance are flag-gated OFF and unimplemented at runtime. External ingestion remains the weakest layer vs. the vision. → **Sprint 3.3**.

### D-5 — Rate limiter is in-memory on multi-replica
- Effective per-IP limit = `replica-count × max`. Pre-existing. Fix = `rate-limit-redis`. → **Sprint 3.4**.

### D-6 — Cross-region worker divergence
- Prod `securelogic-data-rights-worker` + `securelogic-posture-worker` run `region: oregon` but reach the Virginia prod Postgres. Region is immutable post-provision → recreate in-region. → **Sprint 3.4**.

### D-7 — Staging frontend drift (IaC gap)
- `securelogic-app-staging` auto-deploys from `develop` but was historically not in `render.yaml`; env/branch/build config risk is invisible. Re-surfaced during Sentry work. Verify current IaC coverage. → operational follow-up.

### D-8 — Audit logging coverage is uneven
- Audit logging is wired but coverage across mutations is uneven. High-value actions must be explainable after the fact (`FINAL_PRODUCT_STANDARD.md` §Auditability). → hardening backlog.

### D-9 — Migration runner filename-key skip risk (F-1)
- The runner is filename-keyed; a reshaped migration reusing a filename is silently skipped. Mitigated per-release by the F-1 check in `RELEASE_CHECKLIST.md`, but the runner itself is a latent foot-gun. → tooling backlog.

### D-10 — Voice transcription DIAGNOSED + FIXED + re-enabled (capability-only) on develop; operator browser matrix pending before prod
- **Root cause (cause B — our implementation, NOT an iPad limit).** The diagnostic (PR #420) captured a real attempt: `VOICE-DIAG … cap=unsupported:ios sel=audio/webm rec=audio/webm; codecs=opus blob=audio/webm; codecs=opus/115417B ext=webm http=415 code=unsupported_media_type`. The device recorded a perfectly good **115 KB `audio/webm; codecs=opus`** file — so it was never capability (A) or empty capture (C). The `415 unsupported_media_type` came from the **global "STRICT CONTENT-TYPE ENFORCEMENT" guard** in `src/api/app.ts`, which rejects any non-`application/json` body. Its exemption list (webhooks, vendor-assurance/analyze-document uploads, SSO ACS) **omitted `/api/ask/transcribe`**, so the multipart audio upload was 415'd **at the gate, before reaching the route** — which is why the engine's own transcribe diagnostics never fired.
- **Scope of impact:** this broke voice on **every browser/device**, not just iPad (desktop Chrome also records `audio/webm; codecs=opus`). The "fails on iPad" report was just where it was first tested. The earlier "WebM-only / iOS mp4" framing was wrong and is withdrawn.
- **Fix (shipped to `develop`):** added `/api/ask/transcribe` to the content-type exemption list (extracted to a tested pure predicate `src/api/lib/contentTypeAllowlist.ts` so it can't silently regress), and hardened the transcribe `fileFilter` to match the **base MIME** (`audio/webm` from `audio/webm; codecs=opus`) instead of relying on exact-match + filename extension. No billing/Stripe/migrations/flags/render.yaml/main/prod touched.
- **Re-enable (shipped to `develop`):** with the root cause fixed, `voiceSupport.ts` now gates on **capability only** — `getUserMedia` + `MediaRecorder` + a supported format (webm/mp4). No browser/device is blacklisted by name; iPad/iPhone get the mic when capable, and it hides only on a genuine capability gap. The server pipeline is proven by automated tests (`transcribeRoute.test.ts`: `audio/webm; codecs=opus` and `audio/mp4` → `200 ok` through the real guard + multer + mocked Whisper) and a guard regression test (`contentTypeAllowlist.test.ts`: `/api/ask/transcribe` multipart is never 415'd).
- **Remaining = operator live-browser confirmation before prod promotion (NOT yet done).** The end-to-end browser matrix — record on **iPad Safari + Desktop Chrome + Desktop Safari** on staging and confirm `VOICE-DIAG … http=200`/auto-filled query — has **not** been run from this automated session (no device/Premium-session/Render-log access). Capture it before promoting to `main`; if any browser genuinely can't record, capability detection already hides voice gracefully with a diagnostic. Procedure + decision/launch rules: `SPRINT_2.md` → **Voice Diagnostic Workstream (A-3)**.

### D-11 — Ask navigation now auto-derived from an Application Knowledge Index (drift risk RESOLVED)
- Ask SecureLogic's **platform navigation answers** (menus, dropdowns, labels, routes, page titles, per-item permissions) are now rendered from a **machine-generated Application Knowledge Index** (`src/api/lib/applicationKnowledgeIndex.generated.ts`), derived from the live source of truth — `app/src/lib/navigation.ts` (the header menu) + the `app/src/app/**` route tree — via `npm run generate:knowledge-index`. **Drift is structurally prevented:** `src/api/tests/applicationKnowledgeIndex.test.ts` rebuilds the index from the live sources and fails CI if the committed artifact is stale, asserts every menu destination resolves to a real `page.tsx`, and asserts every route an Ask workflow cites exists in the index. If someone renames a menu item or moves a page without regenerating, the `test` lane goes red.
- **Residual (minor):** the workflow *how-to prose* (the semantic intent→action mapping, e.g. "click + Add Vendor") remains curated in `productKnowledge.ts`, but **every path/label it cites is verified against the generated index** by the same test — so it cannot reference a UI that doesn't exist. Regenerate the index (`npm run generate:knowledge-index`) whenever the menu or routes change.

---

## 🟢 Cosmetic / orientation

### C-1 — Interim brand mark
- Launch uses an **approved** interim icon-only PNG (no wordmark). Official brand SVG + favicons are a post-launch swap. Explicitly **not** a blocker. → **Sprint 2.5**.

### C-2 — Demo is a logical surface, not an environment
- Demo is a seeded org in a non-prod DB (`scripts/seed-demo.ts`), not a deployed peer to Staging. Must not be used as a release-validation substitute. Promotion to a deployed env is optional/future. → **Sprint 3.4**.

### C-3 — Open Dependabot PRs targeting `develop`
- ~10 Dependabot dependency-bump PRs are open against `develop` (correctly targeted, not `main`). Routine hygiene, not launch-blocking.

### C-4 — Lemon Squeezy dormant code retained
- LemonSqueezy webhook handler is retained but the `/webhooks/lemon` route is unmounted (404). Stripe is authoritative; Lemon is slated for full removal. Orientation only.

---

## Maintenance rule

When any item here is resolved, update its row **and** the corresponding Sprint doc in the same change. An entry that is fixed-in-code but left "open" here is itself a documentation defect.
