# VA-S4-P2 — the governed opinion-acceptance surface, staging acceptance

**Package:** VA-S4-P2 / wiring-plan step 4b
**PR:** #944 — merged to `develop` as `de035043` (build `b6cac814`, isolation fix `270e59b9`)
**Migration:** `20261070_assurance_opinion_basis.sql`
**Staging engine:** `srv-d7n0rju8bjmc738jbs7g`, **live on `de035043`**, `APP_ENV=staging`
**Jobs:** `job-daa7oe6k1f9s73flmv30` (read-only), `job-daa7p51f2nfc739fqkeg` (apply),
`job-daa7q3hsrm7s73e73qq0` (read-only inventory)
**Result: 15 PASS / 0 FAIL / 1 not exercised / 0 errors.**

**S4 IS STILL NOT WIRED.** `assuranceCoveredRequirementIds` has zero production
callers. Nothing in this package computes coverage, reduces questionnaire depth,
changes residual risk, or overrides an exception.

---

## 1. What existed before, and what was actually missing

`20261066` (PR #936) shipped the closed opinion vocabulary, `opinionCoverageGate`,
the advisory proposal normalizer and an authority CHECK making an opinion without
a named acceptor structurally impossible — and shipped **no writer**. S4-P1 (#943)
measured the consequence: `assurance_opinion` appeared in exactly two files,
neither of which could set it, and **no row had ever reached the opinion hop in
any environment**.

Before this package, estate-wide accepted opinions: **0**.
After: **1** — the first governed assurance opinion that has ever existed.

## 2. Preflight, on the deployed SHA

`20261070` is applied. `schema_migrations` carries it as the 11th of the
`2026106x/7x` block, after `20261069_control_canonical_identities.sql`.

The authority CHECK, read from `pg_constraint` on staging:

```
CHECK (((assurance_opinion IS NULL) AND (assurance_opinion_accepted_at IS NULL)
        AND (assurance_opinion_basis IS NULL))
    OR ((assurance_opinion IS NOT NULL) AND (assurance_opinion_accepted_at IS NOT NULL)
        AND (assurance_opinion_accepted_by_user_id IS NOT NULL)
        AND (assurance_opinion_basis IS NOT NULL)))
```

Six `assurance_opinion*` columns present, `assurance_opinion_basis` as `jsonb`.

**Rollback proven on a real database** (local harness, full migration set):
`ROLLBACK-20261070.sql` restores the exact `20261066` CHECK form and is
idempotent; `20261070` re-applies on top and is itself idempotent. The ordering
hazard — the constraint must be restored *before* the columns drop — is correct
as written.

## 3. Corpus, measured before any write

| Organization | Documents | Approved | Approved w/ NULL approver | Extracted | Accepted opinions |
|---|---|---|---|---|---|
| Staging Inc | 53 | 2 | **0** | 2 | 0 |
| [SEED] Walkthrough Org | 3 | 0 | 0 | 0 | 0 |
| Standing Inc 3 | 1 | 0 | 0 | 1 | 0 |

**No corpus preparation was needed.** Staging Inc already held two `approved`
documents with a named approver, so the acceptance ran against real workflow
state. **No document was approved by this package** — the only writes are the
opinion acceptance and its supersede.

Actor: `the5crystians@gmail.com` (`786c4a37`), role `admin`, org Staging Inc
(`fe2ede61`, `platform` / `active`). The session JWT was minted inside the job
from the service's own `JWT_SECRET`, because the acceptance route requires an
authenticated **user** — see §4.

## 4. Authorization: the 403 is structural, not decorative

`req.userId` is set on **exactly one code path** — the JWT-bridge branch of
`requireApiKey.ts:241`, i.e. a Bearer session token. A raw API key sets
`req.apiKey` and leaves `req.userId` undefined.

So `human_acceptor_required` (403, raised before any query) means opinion
acceptance is **gated on a human session by construction**, and every
machine-only integration on the Vendor Assurance surface is refused. Without it
the `20261066` authority CHECK would surface an unattributed caller as a **500**.

## 5. The adversarial matrix, over HTTP on the deployed SHA

| # | Assertion | Expected | Actual | |
|---|---|---|---|---|
| 1 | cross-tenant: a REAL document owned by another org | 404 | 404 `vendor_assurance_document_not_found` | PASS |
| 2 | non-uuid document id | 400 | 400 `document_id_must_be_uuid` | PASS |
| 3 | document not approved | 409 | 409 `vendor_assurance_document_not_approved` | PASS |
| 4 | value outside the closed vocabulary | 400 | 400 `invalid_assurance_opinion` | PASS |
| 5 | departing from the candidate with no reason | 400 | 400 `reviewer_note_required_for_override` | PASS |
| 6 | governed acceptance | 200 | 200, `qualified`, acceptor `786c4a37` | PASS |
| 7 | acceptance establishes no coverage | `false` | `false` | PASS |
| 8 | silent overwrite of a standing opinion | 409 | 409 `assurance_opinion_already_accepted` | PASS |
| 9 | supersede with no reason | 400 | 400 — **see the caveat below** | PASS (status only) |
| 10 | explicit supersede | 200 | 200, `adverse` | PASS |
| 11 | supersede establishes no coverage | `false` | `false` | PASS |
| 12 | audit records BOTH acceptance and supersede | true | true | PASS |
| 13 | the basis carries `establishes_requirement_coverage: false` | `false` | `false` | PASS |
| 14 | the basis snapshots the prior acceptance | true | true | PASS |
| 15 | `note` holds the REPORT text, not the reviewer's | true | true | PASS |
| — | 403 unattributed caller | 403 | **not exercised over HTTP** | see below |

Cross-tenant arm 1 is the strong form: a **real** document id
(`788e7fa4`, owned by Standing Inc 3) requested by a Staging Inc session returns
404, not 403 and not a leak of its existence.

### Two honest caveats — neither is a pass that should be read as more than it is

**Check 9 returned the right status for the wrong reason.** The request sent
`opinion: "adverse"` with `supersede: true` and no note. The candidate is
`qualified`, so `adverse !== qualified` and the **override** branch fired first:
the body was `reviewer_note_required_for_override`, not
`reviewer_note_required_for_supersede`. The supersede-note branch was therefore
**not exercised on staging**. It is proven at handler level
(`opinionAcceptance.test.ts`: *"requires a note on supersede even when the value
matches the candidate"*, which passes `qualified` against candidate `qualified`
so only the supersede branch can fire). Guard-order fact worth keeping: the
override check precedes the supersede check.

**The 403 arm could not be exercised over HTTP.** `api_keys` stores only a hash,
so no plaintext staging key is recoverable from inside the job. It is proven at
handler level and structurally (§4). Recorded as *not exercised* rather than
counted as a pass.

## 6. The persisted row

```json
{
  "assurance_opinion": "adverse",
  "assurance_opinion_note": "Unqualified opinion, except for the specific deviations and exception described in Section IV",
  "assurance_opinion_reviewer_note": "[VA-S4-P2 STAGING ACCEPTANCE 2026-08-30] explicit re-decision, ...",
  "assurance_opinion_accepted_by_user_id": "786c4a37-...",
  "assurance_opinion_accepted_at": "2026-08-30T18:55:47.850Z",
  "assurance_opinion_basis": {
    "basis_version": "opinion-acceptance-1.0",
    "source": { "origin": "extraction", "extraction_id": "f5d47ce6-...",
                "auditor_opinion_text": "Unqualified opinion, except for ..." },
    "proposal": { "candidate": "qualified", "rule": "\\bexcept\\s+for\\b",
                  "reason": "the opinion carves out matters with 'except for'",
                  "normalizer_version": "opinion-normalizer-1.0" },
    "human_agreed_with_candidate": false,
    "coverage_gate_at_acceptance": "ineligible",
    "document_state_at_acceptance": { "processing_status": "approved",
                                      "approved_by_user_id": "786c4a37-..." },
    "supersedes": { "opinion": "qualified", "accepted_by_user_id": "786c4a37-...",
                    "accepted_at": "2026-08-30T18:55:47.701Z", "reviewer_note": "..." },
    "establishes_requirement_coverage": false
  }
}
```

**The normalizer was proven right on live data.** The staging opinion string
contains BOTH "Unqualified opinion" and "except for"; the proposal resolved it to
`qualified` via `\bexcept\s+for\b`. A `LIKE '%Unqualified%'` test would have read
it as clean. That is the whole reason the normalizer exists, and it is now
demonstrated end to end against a real extraction rather than a fixture.

**The two columns stay distinct.** `assurance_opinion_note` holds the report's
own words; `assurance_opinion_reviewer_note` holds the human's. Asserted.

Audit: `vendor_assurance.opinion.accepted` then
`vendor_assurance.opinion.superseded`, both actor-attributed. A first acceptance
and a re-decision are different event types.

## 7. Item G — the tested-controls inventory (Ruling 5 input)

Five extractions estate-wide: 4 in Staging Inc, 1 in Standing Inc 3.
**25 tested-control entries (exactly 5 per extraction), 10 exception entries
(exactly 2 per extraction).**

Every `controls[]` entry has exactly four keys, present on 25/25:

| Key | What it holds |
|---|---|
| `control_id` | the **vendor's** control reference — `CC6.1 CC6.2 CC7.2 A1.2 C1.1` |
| `description` | the control statement |
| `test_procedure` | what the auditor did |
| `result` | **free text**, no structured pass/fail |

Report-level fields present on all 5: `report_type`, `report_period_start`,
`report_period_end`, `trust_services_criteria`, `subservice_method`,
`subservice_organizations`, `auditor_name`, `auditor_opinion`, `controls`,
`cuecs`, `exceptions`, `management_responses`, `vendor_name`.

### Three findings that change the step-4c design

**1. `result` is prose, and this is the auditor-opinion problem again.** Three
distinct values across 25 entries: `"No exception noted."` (15),
`"Exception noted: for 2 of 30 sampled days …"` (5), `"Deviation noted: the Q3
privileged access review was completed 19 days after …"` (5). There is **no
boolean, no enum, no pass/fail column**. A keyword test on model-extracted prose
is exactly the coin flip `20261066` was written to prevent — so the
tested-controls arm needs its own closed vocabulary, its own deterministic
proposal normalizer, and its own human acceptance. It cannot be a SQL predicate
over `result`.

**2. Exceptions ARE attributed to a control — a recorded fact was wrong.** The
wiring plan's Ruling 4 blocker states that nothing attributes an exception to a
control. Measured: every one of the 10 `exceptions[]` entries carries
`control_id`, `description` and `auditor_assessment`, and its `control_id` joins
directly to `controls[].control_id` (`CC6.2`, `A1.2`). The exception veto is
therefore **directly expressible today**. What is missing is not attribution.

**3. The canonical crosswalk does not cover SOC 2 at all — this is the real
content gap.** Published crosswalk coverage is `nist-csf 1.1` only, 75 rows.
Every assurance document is `SOC 2 Type II` with TSC
`Security / Availability / Confidentiality`, and every vendor control id is a TSC
reference. **There is no SOC 2 TSC → canonical control crosswalk**, so Ruling 5's
chain has a missing link at exactly the hop that turns a tested vendor control
into a requirement. Step 1's corpus work is not finished; it is not even started
for the framework the evidence is actually written in.

### Veto expressibility, measured rather than assumed

| Veto (Ruling 5) | Expressible today? | Evidence |
|---|---|---|
| report / TSC scope | **yes** | `trust_services_criteria` on 5/5 |
| report period / validity | **yes** | `report_period_start/end` on 5/5 (`2025-01-01`–`2025-12-31`) |
| Type I vs Type II | **yes** | `report_type` = `SOC 2 Type II` on 5/5 |
| tested-control result | **NO** | free text only — finding 1 |
| control exception / deviation | **yes** | `exceptions[].control_id` on 10/10 — finding 2 |
| carve-out / subservice | **yes**, and live | `subservice_method` = **`Carve-out`** on 5/5, 3 subservice orgs each |
| accepted auditor opinion | **yes — BUILT** | this package |
| contradictory evidence | no | no cross-source contradiction model |
| relevant open findings | partial | expressible on `requirement_id`, not `framework_control_id` |
| mapping authority | **NO** | `control_canonical_identities` has ONE writer (`templateLoader`); `attestation` / `customer_mapped` / `inferred` have no route |
| human / governed acceptance | pattern proven | this package is the template |
| historical decision basis | **yes** | `assurance_opinion_basis`, snapshotted by value |

**Every one of the five documents is a carve-out report.** The carve-out veto is
not a hypothetical edge case in this corpus — it fires on 100% of it.

## 8. Item I — fan-out, re-measured through the governed crosswalk

S4-P1 measured fan-out at the **tenant-control** grain and reported a maximum of
four. Measured at the **crosswalk** grain, which is the grain coverage would
actually propagate along:

| | |
|---|---|
| canonical controls in the crosswalk | **44** |
| mapping to more than one requirement | **21** (48%) |
| maximum requirements for one canonical control | **5** |

**The number to carry forward is 5, not 4.** Nearly half the published corpus
fans out. Under Ruling 6 this is decisive: if a single tested vendor control
could discharge every requirement its canonical control maps to, one
"No exception noted." would silently reduce depth on up to five requirements —
and 21 of 44 controls would do it to at least two.

This is why candidate ≠ covered has to be enforced at the **requirement** grain,
not the control grain. A sufficiency determination attached to the canonical
control cannot express "this test supports DE.AE-1 but not DE.CM-5".

## 9. h5 disjoint tenancy — still the terminal break

| Organization | Accepted opinions | Canonical identities |
|---|---|---|
| Staging Inc | **1** | 0 |
| Enterprise Validation StageA | 0 | **30** |
| Standing Inc 3 | 0 | 0 |
| [SEED] Walkthrough Org | 0 | 0 |

`orgs_holding_both_halves: 0`. The org that now holds the first governed opinion
holds no canonical identity; the org holding all 30 identities holds no assurance
document. **S4 would still measure zero**, for the reason S4-P1 established and
for no new reason. Building step 4b did not move that, and was never going to.

## 10. Staging rows written by this package

Two writes, both through the real routes, both by a real authenticated user, both
on document `1dbc1dbf-5f4c-48c3-b43f-592b072e932d` (Staging Inc):

1. accept `qualified` (the normalizer candidate) — 18:55:47.701Z
2. supersede to `adverse` — 18:55:47.850Z

Both reviewer notes are prefixed `[VA-S4-P2 STAGING ACCEPTANCE 2026-08-30]`, so
the rows are identifiable and removable. Removal, if wanted:

```sql
UPDATE vendor_assurance_documents
   SET assurance_opinion = NULL, assurance_opinion_note = NULL,
       assurance_opinion_reviewer_note = NULL, assurance_opinion_basis = NULL,
       assurance_opinion_accepted_by_user_id = NULL, assurance_opinion_accepted_at = NULL
 WHERE id = '1dbc1dbf-5f4c-48c3-b43f-592b072e932d'
   AND assurance_opinion_reviewer_note LIKE '[VA-S4-P2 STAGING ACCEPTANCE%';
```

The two `security_audit_log` rows are immutable by trigger and are correct
history — they are not removed.

**Recommendation: RETAIN.** The rows were produced by the real route from a real
extraction, they are the only demonstration that the opinion hop is reachable,
and the supersede chain is the only live example of the decision-basis snapshot.
No production data was manufactured.

## 11. Authority statement

Not done, deliberately: `assuranceCoveredRequirementIds` not wired into
composition; S4 suppresses and reduces nothing; residual risk untouched; evidence
authority unchanged; no second evidence architecture; no CUEC route revival; no
questionnaire issued or reissued; no scope mutated; no promotion; no Blueprint
sync; no production change of any kind.

## Related

`docs/design/VA-S4-assurance-wiring-plan.md` §0a (Rulings 5 and 6), §7 steps 4b/4c,
`docs/validation/VA-S4-dead-hop-forensics-2026-08-30.md`,
`docs/validation/VA-S4-canonical-control-publication-2026-08-30.md`, #925, #926.
