# VA-S4-4C-3 — the three-layer assurance outcome model

**Status:** built, staging acceptance pending
**Migrations:** 20261074, 20261075, 20261076, 20261077
**Owner decisions:** 2026-08-31, sections 1–10, plus the approved three-key
correction to decision 4
**Corpus measured:** staging (`securelogic-staging-db`), 2026-08-31 — 17
extractions, 51 tested controls, 25 distinct `result` strings, 20 exceptions,
16 management responses

---

## The distinction this document exists to preserve

**Synthetic observations establish REPRESENTABILITY, not real-world prevalence.**

Twelve of the seventeen extractions in the measured corpus belong to one
controlled fixture organization. They prove that a shape *can* occur in a SOC 2
report. They prove nothing about how often it does. Every count in this document
is labelled REAL or SYNTHETIC, the validation harness reports the two separately,
and `organizations.tenant_class` makes the separation machine-readable so a later
reader cannot lose it.

Where a design decision rests on a synthetic witness, that is stated. A contract
must be able to *represent* what a report can say; prevalence is the wrong test
for a contract.

---

## Why there are three layers and not one verdict

A single "is this control fine" field would have to fuse three answers that
legitimately disagree:

| | Question | Who answers | Where |
|---|---|---|---|
| **Layer 1** | What did the auditor *say*? | The source report | `vendor_tested_control_assertions` |
| **Layer 2** | What does SecureLogic *govern*? | A named human | `vendor_tested_control_effectiveness` |
| **Layer 3** | What does an exception *mean*? | A named human | `vendor_assurance_exceptions` |

A control can be `EXCEPTION_NOTED` at Layer 1, `EFFECTIVE` at Layer 2, and carry
a standing `scope_limitation` at Layer 3 — all three true at once, because the
exception concerns a workflow the tenant does not use and the auditor could not
obtain evidence for a period that predates the contract. Fusing them loses two
of the three facts and no query can get them back.

---

## Layer 1 — the auditor assertion

Nine values. Machine-produced, deterministic, versioned
(`tested-control-assertion-1.0`), always stored beside the auditor's verbatim
result.

| Value | Corpus witness | Provenance |
|---|---|---|
| `NO_EXCEPTION_NOTED` | "No exception noted." | **REAL** |
| `EXCEPTION_NOTED` | "Exception noted: for 2 of 30 sampled days, failed backup jobs were not investigated…" | **REAL** |
| `DEVIATION_NOTED` | "Deviation noted: the Q3 privileged access review was completed 19 days after the documented due date." | **REAL** |
| `NOT_EFFECTIVE_STATED` | "The control did not operate effectively. For 11 of 20 sampled terminations…" | SYNTHETIC |
| `NOT_TESTED` | "Not tested. Physical security is carved out…" | SYNTHETIC |
| `NOT_APPLICABLE` | "Not applicable. The service organization does not retain confidential information…" | SYNTHETIC |
| `INCONCLUSIVE` | "Test results were inconclusive for the period 1 January to 31 May 2025…" | SYNTHETIC |
| `DESIGN_ONLY` | "The control was suitably designed as of 31 December 2025. Operating effectiveness was not tested." | SYNTHETIC |
| `NOT_STATED` | **none** — 0 of 51 controls has a null result | structurally reachable |

`NOT_STATED` is the one value with no witness. It ships anyway because the
extraction contract declares `result: string|null`, so a writer *can* produce it.
That is the distinction the CUEC `review_status` value `'accepted'` got wrong:
that value no writer could ever produce.

### Exception and deviation are terminology, not severity

Owner ruling, and it is enforced structurally: the vocabulary is an unordered
set with no ordinal, the two values route to identical governed treatment (no
candidate — a human decides), and `source_term` preserves the auditor's own word
without interpreting it. A test asserts the two are not ranked so that
introducing a severity map has to delete it deliberately.

### Precedence, and the string that determined it

Order is load-bearing, because the most common string in the corpus contains its
own trap:

1. absent → `NOT_STATED`
2. **clean negations** → `NO_EXCEPTION_NOTED` — first, because *"No exceptions
   noted"* contains the word "exception" and every naive matcher gets it backwards
3. `NOT_APPLICABLE` — applicability outranks the not-tested clause that follows it
4. `DESIGN_ONLY` — a Type I design opinion says "not tested" in the same breath
   and is not a skipped control
5. `INCONCLUSIVE` — tested-but-unable-to-conclude ≠ not tested
6. `NOT_TESTED` — including carve-outs and out-of-scope categories
7. `NOT_EFFECTIVE_STATED`
8. `EXCEPTION_NOTED` / 9. `DEVIATION_NOTED` — the auditor's own word
10. anything else → `NOT_STATED`, **never** `NO_EXCEPTION_NOTED`

### Layer 1 has no human authority, and that is the design

The table has no actor column at all. Layer 1 is a *reading of the source*; a
reviewer who disagrees says so at Layer 2, with a note. Giving Layer 1 its own
acceptance surface would create a second place where a human appears to settle a
control's outcome, and the two would drift.

---

## Layer 2 — governed effectiveness

`EFFECTIVE` / `INEFFECTIVE` / `INDETERMINATE`. Decided by a named human.

**There is deliberately no `EFFECTIVE_WITH_EXCEPTION.`** Layer 2 is orthogonal to
exception state. Nothing in migration 20261076 references, joins to, deletes from
or constrains against Layer 3 — so accepting `EFFECTIVE` *cannot* erase an
exception, because it does not touch the table exceptions live in.

`INDETERMINATE` requires a reason from a closed set with no catch-all:
`not_tested`, `not_applicable`, `scope_limited`, `design_only`. An outcome that
fits none of them cannot be recorded, which leaves it visibly unaccepted rather
than absorbed into a bucket that makes the gap unmeasurable.

### Fail-closed is structural, not policy

Four independent properties, each with a test:

1. **`governed_effectiveness` has no DEFAULT.** Nothing acquires a value a writer
   did not state.
2. **Absence of a row is absence of effectiveness.** Nothing seeds Layer 2 — not
   the materializer, not approval, not anything.
3. **`suggestEffectiveness` never proposes `EFFECTIVE`.** Not for any assertion,
   including `NO_EXCEPTION_NOTED`. The only candidates it offers *reduce* what is
   claimed. A clean auditor line is a statement about one report's testing;
   governed effectiveness is a statement SecureLogic makes on its own authority
   against scope, period, Type I vs II, carve-outs, contradictory evidence and
   open findings.
4. **An unrecognised assertion falls through to no candidate.** Adding a value to
   the Layer-1 vocabulary without revisiting the bridge fails closed.

A finding is *not* auto-proposed as `INEFFECTIVE` either — whether a noted
exception makes a control ineffective is exactly what Layer 3 exists to decide,
and prejudging it in that direction is the same error in the other direction.

### accept / edit / reject

`decision = 'accepted'` carries an effectiveness. `decision = 'rejected'`
withdraws the standing answer and asserts no replacement — no effectiveness, no
reason, a required note. After a rejection there is no live row, which reads as
"not established", which is correct. Edit is supersession: append, never mutate.

---

## Layer 3 — exception identity, linkage, effect

### Why exceptions needed an identity

The pre-v3 contract gave an exception no identifier — only `control_id`,
`description`, `auditor_assessment`. A management response had nothing to point
at except a control, and its field was called `exception_ref`. Given a report
that labels its exceptions, the model wrote:

```
management_responses[0].exception_ref = "Exception 1"
```

An exception *label* in a field the export read as a control identifier. That is
the observation that tripped owner stop condition 4, and it is why the field was
not renamed to `control_ref`: renaming would have moved the ambiguity into a
differently named field.

### Why linkage is a separate table

Same document:

```
exceptions[0].control_id = "CC6.1, CC6.2, CC6.3"
```

One outage spanning three tested controls, packed into a scalar. It matches no
`element_key`, so 20261073's identifier keying could not see it and the exception
silently reached none of the three controls it concerned. Exception-to-control is
genuinely many-to-many.

### The effect vocabulary is two values

| Value | Corpus witness | Provenance |
|---|---|---|
| `control_deficiency` | "3 of 25 access requests lacked documented manager approval"; "the control did not operate effectively" | SYNTHETIC (real corpus witnesses the shape via "Exception noted: …not investigated within SLA") |
| `scope_limitation` | "Scope limitation applied. Sufficient appropriate evidence was not available"; "records prior to 1 June 2025 were not available for inspection" | SYNTHETIC |

Not a severity taxonomy. A scope limitation says assurance was not *obtainable*;
it does not say the control failed. `NULL` means no human has interpreted it yet,
and `NULL` is not "fine".

The effect is never derived from whether the auditor wrote "exception" or
"deviation" — the validator refuses those strings as inputs, and `source_term` is
preserved untouched beside the governed answer.

### No heuristic may silently link

Every link records `link_source` and the verbatim `source_value` it was read out
of:

- `extraction_control_refs` — the corrected contract's explicit array
- `legacy_control_id` — the pre-v3 scalar, retained so historical extractions stay
  readable; when it packed several identifiers the raw string travels with every
  link it produced, so the split is inspectable rather than assumed
- `human` — a person made the link

**There is no `index_alignment` value and there never will be.** That names what
`vendorAssuranceExportData.ts` used to do: match `exception_ref == control_id`
and, failing that, attach `responses[i]` to `exceptions[i]` by array position,
silently, with nothing recorded. That code is deleted, not renamed. Pairing is
now label-then-identical-control-scope, and an unpaired response is reported
`unlinked`.

A *partial* control overlap is deliberately not a match: an exception spanning
CC6.1/CC6.2/CC6.3 and a response about CC6.1 alone are different scopes.

---

## The extraction contract correction — three keys, not a rename

`PROMPT_VERSION`: `soc-extraction-v2` → `soc-extraction-v3`.

| v2 | v3 |
|---|---|
| `exceptions[].control_id: string` | `exceptions[].exception_ref` (the report's own label) **+** `exceptions[].control_refs: string[]` |
| `management_responses[].exception_ref: string` (ambiguous) | `management_responses[].exception_ref` (an exception label, unambiguously) **+** `management_responses[].control_refs: string[]` |

**Historical compatibility.** No extraction is ever rewritten. The reader is
shape-tolerant and reads both key sets unconditionally, recording per link which
key it came from — deliberately *not* version-switched, because a version string
is a claim about what was asked for and the only trustworthy thing about a
historical row is what it actually contains. `prompt_version` is stored per
extraction, `EXTRACTION_CONTRACT_HISTORY` documents both shapes, and the
acceptance harness proves a v2 extraction still materialises correctly with its
source byte-identical afterwards.

---

## Authorization — capability *and* human, on orthogonal axes

`assurance:review` is added to the existing `Capability` union in `seatScope.ts`.
No parallel authorization system. It is granted alongside `risk:accept` to
tenant-write identities, so Viewer and Contributor seats do not hold it.

**The capability is necessary and not sufficient.** `scopeForApiKey()` resolves an
API key to a full/admin seat, so a machine caller holds every capability a
tenant-write identity holds — including this one. A capability answers *"is this
identity permitted"*; it structurally cannot answer *"is this a human"*.

Human authority is enforced twice more, on axes the capability system does not
reach:

- `requireHumanReviewer` refuses an unattributed caller with `403
  human_reviewer_required` before any read or write;
- migrations 20261076 / 20261077 refuse an unattributed governed decision at the
  database, as INSERT-scoped triggers following the 20261071 precedent (a
  steady-state CHECK would make deleting a user who had decided an effectiveness
  fail, turning a data-protection operation into an error).

The acceptance test proves the API key gets `human_reviewer_required` and *not*
`capability_required` — it passed the capability gate and was still refused.

### Three distinct authority actions

| Action | Surface | Audit event |
|---|---|---|
| A. tested-control review | `POST /extractions/:id/review-decisions` (20261072) | `vendor_assurance.review_decision.*` |
| B. governed effectiveness | `POST /documents/:id/tested-controls/:key/effectiveness` | `vendor_assurance.control_effectiveness.decided` / `.superseded` |
| C. document approval | `POST /documents/:id/approve` | `vendor_assurance.document.approved` |

One human may hold all three. Performing one never performs another; nothing in
the Layer-2 handler records a review decision or approves anything.

---

## Synthetic fixture classification

**Nothing existed to reuse.** `organizations` carries 28 added columns across the
migration history and not one says what kind of tenant it is. Nothing in `src/`
or `app/src` reads any such concept. The only thing that exists is a naming
convention in `organizations.name` — `[SEED]`, `[VALIDATION-W1]`,
`[DECOMMISSIONED]` — read by no code, and incomplete: the owner-designated
fixture org (`b1a3da2d`, "Enterprise Validation 20260810") carries no prefix.

Migration 20261074 adds `organizations.tenant_class` ∈ `{customer,
synthetic_fixture}`, default `customer`.

**The default is not the safety mechanism, and saying otherwise would be worse
than admitting it.** A new synthetic org nobody classifies reads as real.
Defaulting the other way makes every genuine new customer vanish from analytics —
a defect somebody "fixes" by flipping the default back, leaving nothing. The
safety lives in three other places:

1. `realCorpusOrgPredicate()` in `src/api/lib/tenantClass.ts` — the one governed
   way to ask for the real corpus, emitting a column filter and never an id list;
2. `classifyForMeasurement()` resolves an *unknown* class to synthetic — the
   fail-closed direction for measurement, deliberately opposite to the column
   default, because a value the code cannot recognise does not get to back a
   claim about the world;
3. `corpusQueryHygiene.test.ts` fails the build on a hard-coded organization UUID
   in application code, on a hand-written `tenant_class` comparison outside the
   helper, and on any runtime code classifying a tenant by name.

The name-prefix convention is read **once**, in the migration, as a one-time
backfill. Runtime reads the column.

**Deliberately not backfilled:** staging orgs that look synthetic but match no
in-tree convention and were not named by the owner — "Staging Inc", "Enterprise
Validation StageA", "Onboarding Validation …", "Deliverability Check 773".
Guessing at those would be inventing facts about tenants. The acceptance harness
reports them at check 41 for an owner decision.

---

## What this package does NOT do

- **No S4 wiring.** No `assuranceCoveredRequirementIds` caller is added; nothing
  reads these tables for coverage.
- **No questionnaire reduction.** Nothing shortens or suppresses a question.
- **No requirement sufficiency (4C-4).** Not built.
- **No production activation.** `SECURELOGIC_VENDOR_ASSURANCE_ENABLED` is `false`
  on production and is not changed.
- **No Blueprint sync.**

Every API response restates `establishes_requirement_coverage: false`, and so
does every audit event payload.

---

## Known gaps, stated plainly

- **Layer 2 has no UI.** The routes exist and are tested; the reviewer screen is
  not built. Same position `assurance_opinion` was in after VA-S4-P2.
- **Both approved documents on staging have `document_type_hint = NULL`**, so
  `resolutionFrameworkForDocumentType` returns null and neither materialises
  anything. This is 20261073's closed framework gate working as designed, not a
  defect — but it means the *existing* corpus produces no Layer-1 or Layer-3 rows
  until a document declares its type. The acceptance harness creates fixtures
  that do.
- **`control_deficiency` has no REAL-corpus witness** as a governed effect,
  because no human has ever interpreted an exception. Both effect values rest on
  synthetic representability. Prevalence is unknown and is not claimed.
