# IA-1 — Internal Assessment Content Versioning

**Status:** OPEN — tracked, not scheduled. Deliberately SPLIT OUT of WA-4 by
owner ruling (2026-09-05).
**Class:** historical-integrity / content addressing.
**Severity recommendation:** **P2 — real mechanism, zero demonstrated exposure,
not a production-activation blocker.** Evidence and reasoning below.
**Determined:** 2026-09-05, read-only. Nothing was mutated or backfilled.

---

## 1. What the issue is

`requirement_responses` is one table serving **two different assurance spines**:

| spine | written by | `engagement_id` | `question_version_id` |
|---|---|---|---|
| Vendor Assurance (portal / engagement) | `vendorPortal.ts`, `vendorEngagements.ts` | set | **stamped** (VA-Q1 P2, migration `20261060`) |
| Internal assessment (this issue) | `POST /api/requirement-responses` (`src/api/routes/requirements.ts:882`) | **NULL** | **NULL** |

The internal spine binds an answer to `requirement_id` only. The canonical text
it was answered against — `requirements.title` and `requirements.description` —
is **mutable in place** and carries **no version row and no `updated_at`**.

The reading surfaces render the answer beside the **live** requirement text:
- `GET /api/frameworks/:id/requirements` (`requirements.ts:685`) returns the
  requirement and its current response together;
- `app/src/app/compliance/[frameworkId]/assess/AssessmentChecklist.tsx:68,100`
  renders `req.title` and `req.description`;
- `app/src/app/vendors/[id]/assess/framework/VendorAssessmentChecklist.tsx`
  does the same for the legacy analyst-completed vendor path.

So an answer recorded on one wording can later be displayed under different
wording, with nothing recording that the wording moved. **This is the same class
of risk WA-3 corrected for Vendor Assurance** — and it is the class WA-3
deliberately did NOT close, because its freeze migration
(`20261091`) joins on `rr.engagement_id = p.engagement_id` and therefore
touches only engagement-scoped rows by construction.

### The one live mutation path
`PATCH /api/requirements/:id` (`requirements.ts:533`) — `requireAdminRole` +
`premium` + `denyContributor` — updates `requirements.description` in place.
Its audit event `requirement.curated` (`requirements.ts:625`) records only
`description_from_present` / `description_to_present` as **booleans**. The prior
text is therefore **not recoverable from the audit trail**. Any remediation must
respect that limit and must never fabricate historical text.

### Paths checked and ruled OUT as text mutators
- `templateLoader.ts:296` upserts with `DO UPDATE SET title = requirements.title`
  — a deliberate no-op. Framework re-activation does **not** rewrite text.
- `scripts/backfillRequirementDescriptions.ts:44` writes only
  `WHERE (description IS NULL OR description = '')` — it fills, never overwrites.
  (Separate, unrelated note: that script selects frameworks by name+version with
  no organization filter. One-time script, not a route. Not part of this issue.)
- `requirements.title` has **no live mutation path at all** — the curation patch
  validator does not accept it. The exposure is `description` only.

---

## 2. Owner-requested determination — answers

Measured on **staging** (`securelogic_staging`, 19 orgs, 289 migrations applied,
latest `20261092`), 2026-09-05, via a read-only job on the deployed engine
service. No prod data was queried (see §3).

| Question | Answer |
|---|---|
| Which product/workflow uses this route | Two surfaces: **internal framework self-assessment** (`/compliance/[frameworkId]/assess`, `assessment_type='self'`) and the **legacy analyst-completed vendor framework assessment** (`/vendors/[id]/assess/framework`, `assessment_type='vendor'`, pre-dating Vendor Assurance engagements). |
| Customer-facing, analyst-only, legacy, or actively used | **Customer-facing and actively used.** Neither page is behind a feature flag; both are gated by session + entitlement only (`premium` / `platform` / `team`). The vendor surface is *legacy* in the sense that Vendor Assurance supersedes it, but it is still routable and still writes. |
| Do new writes currently reach it | **Yes.** Staging rows landed **2026-09-04 (3)** and **2026-09-05 (1)**. The path is live, not dormant. |
| Rows with NULL/missing immutable content version | **6** (`engagement_id IS NULL AND question_version_id IS NULL`): 1 `self`, 5 `vendor`. |
| Affected orgs | **1** — `[SEED] Walkthrough Org` (`295b989a…`), a validation seed org, not a customer tenant. |
| Affected requirements | **5** (1 self + 4 vendor). |
| Has affected canonical text changed after a response was recorded | **No — zero instances.** The join of `requirement_responses` (engagement NULL) against `security_audit_log` `requirement.curated` events where `created_at > assessed_at` returns **an empty set**. Only 4 curation events exist in the whole database, on 2 requirements (`CC6.1`, `A1.1`), both from deliberate immutability tests. |
| Can historical responses currently render against changed text | **Mechanically yes, factually not today.** The rendering path reads live text and nothing prevents drift; no row is currently in a drifted state. **Evidential limit, stated plainly:** `requirements` has no `updated_at` and the audit payload stores booleans, so absence of an audit event is not proof that no direct script or backfill ever ran. This is the same limit recorded in `docs/validation/wa3-historical-corpus-determination-2026-09-05.md`. |
| Do these records participate in Findings, Remediation, residual risk, decisions, reports, exports, audit evidence | **Findings: no.** 2 findings touch requirements that also carry an internal response, and **both are `source_type='vendor_engagement'`** — they were promoted from the VA spine, not from an internal response. No `source_type` promotes from `requirement_responses` with a NULL engagement. **Reports: partially.** The rows feed *counts only* — `GET /frameworks/:id/progress` (`frameworks.ts:274`, `assessment_type='self'`) and `GET /vendors/:id/framework-progress` (`vendorFrameworkProgress.ts:96`, `assessment_type='vendor'`). Both aggregate `status` and render **no requirement text**, so content drift cannot corrupt them. **Readiness: no** — the O-5 ruling already separates progress from readiness, which comes from satisfied control mappings. **Revisions: none** — 0 `requirement_response_revisions` rows exist for internal responses. |
| Does the path participate in Vendor Assurance production behavior | **No.** VA engagement responses are **881/881 versioned** on staging. Of the engagement-scoped responses whose requirement was curated *after* the answer, **18 rows, 0 unversioned** — WA-3's freeze holds. The 4 requirements shared between an internal response and a VA scope item are shared at the *requirement* level; the VA rows carry their own version pointer and are unaffected. |

### Remediation feasibility (measured, not assumed)
All **6/6** affected rows have a bridge question with a version 1 whose `prompt`
is byte-identical to the requirement's current `title` **and** whose `guidance`
is not distinct from the current `description`. A WA-3-style freeze is therefore
available **with zero rendered change and zero fabrication**. That is a
measurement of today's feasibility, not a design decision — the package still
has to decide between freezing historical rows and stamping at write time (it
should almost certainly do both).

---

## 3. Production

**Not measured.** The owner ruling for this session forbids touching production
data, and no production query was run. The prod population is therefore
**owner-owed**, not zero-by-assertion.

Context that bears on it, from the 2026-09-01 measurement: the production
platform estate is empty — evidence, assurance documents, policies and findings
are all at zero, and production is running the Brief wedge only. A nonzero prod
population is unlikely on that basis but is **not proven** and must not be
reported as proven.

---

## 4. Severity and blocker recommendation

**Recommended: P2. Not a blocker for WA-4. Not a blocker for Vendor Assurance
production activation.**

Reasoning, evidence-first:
1. **The Vendor Assurance spine is not exposed.** 881/881 VA responses carry a
   version; the 18 rows whose requirement was curated after the answer are all
   versioned. VA's historical reproducibility does not depend on this fix.
2. **No consequential downstream state depends on it.** No finding, remediation,
   risk or decision sources from an internal response. The only consumers are
   status counts that render no text.
3. **Demonstrated exposure is zero**, and the only affected tenant is a seed
   validation org, not a customer.
4. **But the mechanism is real and the path is live** — unversioned rows were
   still being written on 2026-09-04 and 2026-09-05, so the population grows
   with use. This is why it is P2 and not P3: it is a live regression source,
   and every day of internal-assessment adoption makes the eventual freeze
   harder to perform without fabrication.

**It would become a blocker** if any of these turn out true, and each is a
concrete trigger to re-open the severity question:
- a production query returns a nonzero internal-response population in a real
  customer tenant;
- any workflow is added that promotes an internal response to a Finding, or
  otherwise makes it consequential;
- internal self-assessment is put in front of a customer as an audit-evidence
  or attestation surface.

**Owner ruling honoured:** this is not implemented as part of WA-4. The WA-4
determination found **no security, tenant-isolation or data-integrity dependency
that makes WA-4 unsafe to implement independently** — WA-4 reads canonical
response *state*, never requirement *text*, so its triage derivation is
unaffected by which wording an answer was given against.

---

## 5. Proposed package

**`IA-1 — internal assessment content versioning`**

Shape it should take when scheduled (not authorized here, recorded so the
thinking is not lost):
1. **Stamp forward.** `POST /api/requirement-responses` resolves the bridge
   question for the requirement and stamps `question_version_id` at write time,
   exactly as the VA path does. Stops the population growing.
2. **Freeze back**, bounded and fail-closed, in the WA-3 pattern: bind existing
   rows only where v1 is byte-identical to what they render today; refuse the
   migration rather than smooth a mismatch; describe it as a freeze, never as a
   reconstruction.
3. **Give curation a memory.** `requirement.curated` must record the text it
   replaced, or `requirements` must gain versioned content the way questions
   did. A boolean is not an audit trail. This is the piece that makes the whole
   class closeable rather than perpetually re-frozen.
4. Decide whether the legacy `/vendors/[id]/assess/framework` surface should be
   retired in favour of Vendor Assurance rather than versioned — retiring a
   write path is cheaper than versioning it.

Related: [WA-3 freeze](../../db/migrations/20261091_wa3_historical_question_version_freeze.sql),
`docs/validation/wa3-historical-corpus-determination-2026-09-05.md`.
