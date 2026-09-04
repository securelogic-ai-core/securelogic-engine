# Assessment Composition v1 — design record (2026-09-04)

**Status:** BUILT on `develop` (this package). Methodology owner-approved
2026-09-04; not redesigned here. Companion to
`vendor-onboarding-2.0-methodology.md` (FROZEN), which owns Criticality,
Inherent Risk v2 and the Assessment Tier.

## 1. What this package is

The complete customer workflow from a classified relationship to a vendor
answering a questionnaire that SecureLogic composed and sent:

```
Vendor → Relationship → Contacts → Intake → Criticality + IR → Domains → Tier
  → Assessment Composition → Select recipient → Review invitation
  → Send from SecureLogic → Vendor portal → Questionnaire / evidence
  → existing assurance lifecycle
```

Three capabilities, one engine each — none new:

| Capability | Where it lives | What changed |
|---|---|---|
| Composition | `scopeResolver.ts` (the ONE resolver), scope-rule **1.2.0** | The Core Assurance Set is the S1 baseline with per-objective factual applicability; a snapshot records the whole composition |
| Evidence-aware composition | VA-S4 chain, unchanged | The Core Assurance Set joins the canonical-control crosswalk, so governed SOC evidence reaches its objectives through the existing determination + counting predicate |
| Contact-based issuance sent from SecureLogic | `vendorEngagements.ts` issue route + `inviteEmail.ts` on the shared mailer | Recipient = canonical Vendor Contact; invitation composed (message, due date) and sent; lifecycle (resend / revoke); delivery recorded |

## 2. Core Assurance Set v1 (`securelogic-core-assurance` / `1.0`)

Sixteen presumptive control objectives, CAS-01…CAS-16, declared once in
`src/api/lib/vendorRisk/coreAssuranceSet.ts` and projected from that single
declaration into:

- **the framework template** `FRAMEWORK_TEMPLATES.securelogic_core_assurance`
  (ordinary `requirements` rows per tenant; bridged to immutable question
  versions like every other requirement);
- **the canonical framework identity** (`canonical_framework_versions`,
  migration 20261088 + `canonicalFrameworkIdentity.ts`), so tenant copies carry
  `frameworks.framework_key`;
- **curated scope tags + intended domain** (`curatedFrameworkTags.ts`), so no
  objective is ever classified by a title heuristic;
- **the crosswalk corpus** (`coreAssuranceCrosswalk.ts`, registered in
  `crosswalkCorpora.ts`, published by the existing `publishCanonicalControls`).

Provisioning is lazy and idempotent at composition
(`coreAssuranceProvisioning.ts`), the same INSERT shape as
`POST /frameworks/activate`; the template is also explicitly activatable.

### Applicability (facts only; never tier, criticality or inherent band)

Ten exposure signals are derived from the fact surface once per resolve
(`deriveExposureSignals`): handles_data, sensitive_data, system_access,
operational_dependency, critical_service, ai_involved, technology (PRESUMED
unless `service.type = professional_services`), fourth_parties, regulatory,
any_exposure. Each objective composes them:

| Objective | Applies when |
|---|---|
| CAS-01 security programme, CAS-02 responsibilities, CAS-08 incident response | any exposure |
| CAS-03 personnel screening | sensitive data OR system access OR critical service |
| CAS-04 awareness training, CAS-06 least privilege, CAS-07 revocation | handles data OR system access |
| CAS-05 confidentiality, CAS-14 in transit/at rest, CAS-15 retention/disposal | handles data |
| CAS-09 customer notification | handles data OR system access OR operational dependency |
| CAS-10 continuity/recovery | operational dependency |
| CAS-11 fourth parties | fourth-party exposure ≥ low OR sub-processors declared OR third-party models |
| CAS-12 vulnerability mgmt, CAS-13 patch mgmt | technology AND (data OR access OR dependency) |
| CAS-16 legal/regulatory/privacy obligations | regulatory OR sensitive/personal data |

Every decision carries a by-value basis (the signals and fact values read) and
a customer-facing rationale for BOTH outcomes.

## 3. Composition algorithm (scope-rule 1.2.0)

```
core applicability (facts) ─► universe = requirements − not-applicable objectives
S1  baseline: applicable objectives (S1.core.<ref>, floor) + tier tags on other frameworks
    (`core` on any OTHER framework is no longer unconditional baseline below tier 1)
S2  fact triggers            ─┐
S3  active obligations        ├─ over the reduced universe (add, never re-add an excluded objective)
S5  domain activation        ─┘
S4  governed assurance offset: covered ⇒ depth `confirm` + basis (unchanged; never removal)
cap: floor (objectives + security baseline) never truncated; compliance protected; discretionary dropped in order
```

Tier changes DEPTH (tier 4 attest; tiers 1–3 full) and the tier's own tags,
never core applicability — asserted by test across all four tiers. Customer
policy raises the tier only (`assessmentTier.ts`, unchanged). An engagement
stamped ≤ 1.1.0 re-resolves exactly as before: the stamp selects the corpus.

**Substantive interpretation, stated for the owner:** under 1.2.0 a legacy
`core` tag on any other activated framework (curated or heuristic) is no
longer an unconditional baseline below tier 1. Those requirements still enter
through every other tag, trigger, obligation and domain rule. This is what
"Presumptive Core Assurance Set + …" means in the composition formula; the
previous heuristic `core` fallback was the tier-4 baseline only because nothing
better existed.

## 4. The composition snapshot (`vendor_engagement_composition_snapshots`)

One immutable row per resolve (shared `worm_guard_mutation`, RLS, app_request
SELECT+INSERT). By value: every objective with outcome
(asked / evidence_satisfied / not_applicable / not_provisioned), depth, domain,
rationale, basis and evidence basis; every additional requirement with the
rules that added it; domains; the tier target and overflow; the coverage
dual-read; `no_questionnaire_required`. `snapshot_hash` = sha256 of the
canonical JSON without the timestamp — re-resolving from unchanged inputs
reproduces the hash (isolation-tested). `GET /vendor-engagements/:id/composition`
reads the latest. `engagement_applicability` (#926) is unchanged and still
records only what applied, by owner ruling.

## 5. Evidence / SOC integration

No change to the S4 chain. The crosswalk rows for `securelogic-core-assurance`
make its objectives CANDIDATE requirements when a SOC report's tested control
resolves to a shared canonical control; a human sufficiency determination on
that candidate is what counts (`assurance-coverage-1.1`), and the resolver's S4
offset then asks the objective as a confirmation with the basis riding the
scope item and the snapshot. "SOC report present" bypasses nothing.

## 6. Contact-based issuance, sent from SecureLogic

- `POST /vendor-engagements/:id/issue` — `contact_id` (primary path) or
  `contact_email`; plus `message` (≤ 4000 chars, defaults to the professional
  template), `due_date` (calendar date, not past), `send_email` (default true).
  The credential is minted, stored with the message/due date, and sent through
  `sendEmail` (purpose `vendor.invite`, correlation = invite id) inside the
  tenant transaction; the invite row records `email_delivery_state`
  (sent / failed / suppressed / disabled / not_attempted), the provider message
  id and a short detail. Delivery failure never fails the issuance.
- `POST …/invite/reissue` — resend / change recipient: supersedes the active
  invite and its sessions, mints and sends a replacement (single-active-invite
  rule = duplicate prevention). `POST …/invite/revoke` — access revoked,
  history preserved; the portal middleware treats invite revocation as
  authoritative on every request.
- `GET /vendor-engagements/:id` gains `invite { active, latest, history_count }`
  (metadata only). The portal shows the invite's due date.
- Flag `SECURELOGIC_VENDOR_INVITE_EMAIL_ENABLED`: `true` on the staging engine,
  `false` on production (render.yaml). Dark = issuing works, row says
  `disabled`, the shown-once link remains the delivery path.
- Migration 20261089 adds the six invite columns. Vendor Contact and portal
  credential remain separate: the invite binds `contact_id` for provenance and
  keeps its own address/name snapshot; a contact with an invite cannot be
  deleted (existing rule).

## 7. App

- `AssessmentCompositionSection` — what SecureLogic selected and why, before
  issuance (objectives with outcome + reason, domains, counts, evidence
  satisfaction, additions by domain, "no formal questionnaire required").
- `IssueQuestionnaireFlow` — recipient from the contact directory (name, title,
  email, role, primary, previous recipient; add-contact inline through the
  same directory action) → invitation review (default message, due date) →
  sent (delivery truth; secure link as collapsed recovery).
- `EngagementActionPanel` — "Compose assessment", the flow for issue, an
  Invitation block with delivery state, resend and revoke; every transition
  catches a rejected action call (`TRANSPORT_FAILURE`). `CreateEngagementForm`
  and `OpenFromRelationship` (the journey's two other transitions) carry the
  same guard. Not widened beyond the surfaces this goal touches.

## 8. Not done / owner-only

- A nominal relationship composes to no questionnaire and cannot be issued
  (422 `empty_scope`); the engagement stays `scoped`. Closing such an
  engagement without issuance needs a lifecycle ruling
  (`engagementStateMachine` is the single authority and was not changed).
- Cross-engagement "previous recipient" hints use this engagement's own invite
  history; a vendor-wide recipient history would need a read route.
- Production untouched: flag `false`, no promotion, Vendor Assurance dark.
