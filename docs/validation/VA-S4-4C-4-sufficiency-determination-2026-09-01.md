# VA-S4-4C-4 — the governed sufficiency determination, staging acceptance

**Package:** VA-S4-4C-4 / wiring-plan step 4c-4
**Feature PR:** #964 — merged to `develop` as `8ac9138a`
**Harness PR:** #965 — merged to `develop` as **`2a2b7632`** (head `bf2ae99f`)
**Migrations:** `20261078_staging_tenant_class_backfill.sql`, `20261079_requirement_sufficiency_determination.sql`
**Staging engine:** `srv-d7n0rju8bjmc738jbs7g`, deploy `dep-dab38p5g1s2s73e4esl0`, **live on `2a2b7632`**, `APP_ENV=staging`
**Database:** `securelogic_staging`
**Job:** `job-dab3nlh42hec739p1bfg` — 2026-09-01 02:43:35Z → 02:44:02Z, exit **0**

**Result: 45 PASS / 0 FAIL / 8 NOTE.**

**S4 IS STILL NOT WIRED.** This package makes a sufficiency determination
*recordable and fail-closed*. Nothing in it computes coverage, reduces
questionnaire depth, changes residual risk, or overrides an exception. See §8
for the two dependencies that must land before S4 can proceed.

---

## 1. Supersedes #964's check count

#964's body advertises the harness as **44 checks**. That number is obsolete and
must not be cited.

| SHA | `check()` | `note()` |
|---|---|---|
| `7b7eedd5` — 4C-4 feature | 44 | 9 |
| `3ac8d83f` — authority axis restored | **45** | 9 |
| `2a2b7632` — merged record SHA | **45** | 9 |

The 44 → 45 delta came from `3ac8d83f` adding an assertion that the adversary
API-key **fixture was actually created** — a failed fixture is a failed proof,
not a skipped one. #965 then renumbered rows so no two proofs share an id; it
changed labels only and added no assertion.

**The final, citable result is 45/45.**

Eight NOTE lines were emitted, not nine, because `note(45)` and
`check(45)`/`check(46)` are the mutually exclusive arms of the second-premium-tenant
branch. A second tenant existed, so the checks fired and the note correctly did not.

## 2. Row identity, verified in live output

Row ids came out **unique and complete, 0..51**. `NOTE [0]` (env) and `PASS [0]`
(migration) both appear and are distinguishable by prefix — the documented
preamble convention, not a collision. This is what #965 existed to fix: before
it, the append-only history proof and the API-key authority proof both printed
as `[40]`, making the transcript uncitable.

## 3. Preflight, on the deployed SHA

Both migrations applied 2026-08-31 23:17:17 UTC (rows `[0]`–`[3]`):

- `vendor_requirement_sufficiency_determinations` exists with **RLS enabled**
- the human-attribution trigger exists
- **no override / waiver column exists** — asserted against `information_schema`,
  returning `[]`. There is no human override of epistemic insufficiency, by
  construction rather than by policy.

Tenant classification (`20261078`) held on **positive provenance**, not on names:
the RFC 2606 reserved-TLD org reclassified to `synthetic_fixture` `[4]`, and the
corpus org was **not** reclassified despite a suggestive name `[5]`. Census:
9 `customer` / 7 `synthetic_fixture` `[6]`.

## 4. Fail-closed sufficiency — enforced by the database, not the route

The negative proofs are the package. Route-level refusal alone would prove nothing.

| Row | Proof | Mechanism |
|---|---|---|
| `[25]` | `SUFFICIENT` refused while a veto is unresolved | HTTP 409, naming 5 blocking vetoes |
| `[26]` | the refusal names `contradictory_evidence` as blocking | response body |
| `[27]` | direct SQL cannot store `SUFFICIENT` over a `NOT_EVALUABLE` basis | `..._fail_closed_check` |
| `[28]` | `SUFFICIENT` refused when the basis **counts lie** about the states | `..._fail_closed_check` |
| `[29]` | a basis with **no counts key** is refused, not NULL-dodged | `..._counts_present_check` |
| `[30]` | direct SQL cannot store a **partial** twelve-veto basis | `..._basis_completeness_check` |
| `[31]` | direct SQL cannot store an **unattributed** determination | attribution trigger |

Rows `[27]`–`[31]` are raw SQL against the table, bypassing the API entirely.
The constraint is in the schema, so no future writer — including one that does
not exist yet — can route around it.

Recording behaviour: `INDETERMINATE` is recordable on exactly the blocked basis
`[32]`; a determination writes **no** Layer-1/2/3 row `[33]`; the stored basis
carries all **twelve** vetoes `[34]`; every stored row denies coverage `[36]`;
a silent re-decision is refused with 409 `[38]`; an explicit supersede succeeds
and **retains** the prior row `[39]`; history is append-only — the superseded
decision is still present `[40]`.

Stored veto counts `[37]`: **0 fired, 7 passed, 5 not-evaluable.**

## 5. Human authority — proven, not asserted

This axis is why #965 exists. The pre-`3ac8d83f` harness could pass while the
adversary key was silently broken: a refusal for the wrong reason read as a
proof. That is the defect class #963 fixed for 4C-3, reproduced in 4C-4.

| Row | Proof |
|---|---|
| `[41]` | the adversary API key fixture **was actually created** |
| `[42]` | the machine adversary **is** authenticated and entitled — HTTP 200 on a read |
| `[43]` | an API key holding `assurance:review` is **still refused as non-human** — 403 `human_reviewer_required` |
| `[44]` | and the refusal is **not** an auth, consent or capability failure wearing its clothes |

`[44]` is gated on `[42]`: the read must have returned 200 and the write error
must not be `invalid_api_key`, `no_active_api_key`, or a capability failure.
An auth failure now **fails** this check rather than satisfying it.

Tenant isolation `[45]`/`[46]`: another tenant can neither read the candidates
nor determine on the candidate — 404 on both.

## 6. Estate state — zero SUFFICIENT

`[49]`: **zero** `SUFFICIENT` determinations exist estate-wide. This is the
ruled, expected state, not an absence of testing. Live determinations at sample
time `[48]`: one `INSUFFICIENT` — this run's own row, sampled before cleanup.

Extractions by tenant class `[47]`: 5 `customer`, 13 `synthetic_fixture`.

## 7. Cleanup — proven, including the part the harness does not assert

| Row | Proof |
|---|---|
| `[50]` | no acceptance API key is left active — **by revocation**, since a used `api_keys` row can never be deleted (the `security_audit_log` WORM guard refuses the `ON DELETE SET NULL` cascade) |
| `[51]` | no acceptance document remains |

The harness does **not** assert that the determination rows are gone. That gap is
closed transitively rather than by assumption: `20261079` declares
`document_id UUID NOT NULL REFERENCES vendor_assurance_documents(id) ON DELETE CASCADE`,
so `[51]` establishes the determination rows went with the document. Verified by
reading the migration, not inferred from the passing run.

## 8. What 4C-4 does NOT establish — the S4 blockers

Three of the twelve vetoes returned `NOT_EVALUABLE`, and the harness asserts they
do so **for the right reason** rather than passing vacuously:

| Row | Veto | State | Reason | Blocked on |
|---|---|---|---|---|
| `[19]` | `contradictory_evidence` | `NOT_EVALUABLE` | `no_evidence_link_substrate` | **ADR-0012 `evidence_links` (Step 2)** |
| `[20]` | `report_period` | `NOT_EVALUABLE` | `no_ratified_validity_policy` | **ADR-0012 evidence validity (Step 2) + the validity policy (Step 3)** |
| `[22]` | `open_findings` | `NOT_EVALUABLE` | `open_findings_not_countable` | unpopulated dimension |

`[22]` is the load-bearing one for honesty: `open_findings` **does not pass
vacuously** on an unpopulated dimension. An empty table is not evidence of no
open findings.

Measured staleness `[21]`: report period `2025-01-01` → `2025-12-31`, **244 days**
since period end — unjudgeable today because no ratified validity policy exists.

### S4 cannot proceed

**S4 remains UNWIRED and must stay unwired until both of the following are complete:**

1. **ADR-0012 Step 2** — the `evidence_links` substrate. Without it
   `contradictory_evidence` can never be evaluated, and a determination that
   cannot see contradicting evidence cannot support a coverage claim.
2. **The evidence-validity policy** (ADR-0012 Step 2 validity + Step 3 policy).
   Without it `report_period` can never be evaluated, and a 244-day-old report
   is neither valid nor invalid — it is unjudged.

Wiring S4 before these land would convert two honest `NOT_EVALUABLE` states into
an implied pass. The fail-closed constraint prevents `SUFFICIENT` from being
stored, so the failure mode would not be a bad row — it would be a permanently
`INDETERMINATE` coverage surface that looks broken rather than blocked.

**No ADR-0012 implementation, no S4 wiring, and no production promotion are
authorized by this record.**

## 9. Out-of-scope observations — filed, not fixed here

Two pre-existing behaviours were observed on the staging engine during the run.
**Neither is a 4C-4 failure**, neither is remediated in this package, and both are
filed so they are not lost inside a passing gate record.

- **#966** — `db_query_outside_tenant_scope` (raw-pool fallback) emitted from the
  API-key middleware path: `requireApiKey.js` (5 sites) and
  `attachOrganizationContext.js` (1 site). These queries run *before* the tenant is
  known — that is what authentication does — so the open question is exemption
  versus permanent warn-level noise on the tripwire, not "add org scoping".
  No cross-tenant leak is demonstrated.
- **#967** — `db_pool_saturated` on the `app` pool: `max=8, total=1, idle=0, waiting=1`,
  under a **single** sequential acceptance client. The notable part is `total=1`
  with `waiting=1` — a caller queued while 7 slots went unused. That is either a
  mistimed cold-start warning or a real ceiling; which one has not been
  determined and should not be guessed. No request failed during the run.

## 10. Verdict

**VA-S4-4C-4: STAGING VERIFIED — 45/45 at `2a2b7632`, 2026-09-01.**

CI on head `bf2ae99f`: **8/8 required lanes green** — `audit`, `build`,
`cross-org-isolation`, `lint`, `tenant-coverage`, `test`, `typecheck`,
`url-drift`. Merged through the protected branch at `mergeable_state: clean`
with **no admin bypass**.

**S4 remains unwired and blocked on ADR-0012 Step 2 and the evidence-validity policy.**

---

## Appendix — full transcript

Job `job-dab3nlh42hec739p1bfg`, verbatim; long detail payloads truncated with `…`.

```
NOTE  [ 0] env        database  :: "securelogic_staging"
PASS  [ 0] migration  20261078 and 20261079 are applied  :: ["20261078_staging_tenant_class_backfill.sql @ Mon Aug 31 2026 23:17:17 GMT+0000 (Coordinated Universal Time)","20261079_requirement_sufficiency_determination.sql @ Mon A…
PASS  [ 1] migration  the determination table exists with RLS enabled  :: {"relrowsecurity":true}
PASS  [ 2] migration  the human-attribution trigger exists
PASS  [ 3] migration  NO override / waiver column exists  :: []
PASS  [ 4] tenant     the provenance-established org is now synthetic_fixture  :: {"name":"Onboarding Validation 20260809150033","tenant_class":"synthetic_fixture"}
PASS  [ 5] tenant     the corpus org was NOT reclassified on its name  :: {"tenant_class":"customer"}
NOTE  [ 6] tenant     tenant_class census  :: [{"tenant_class":"customer","n":9},{"tenant_class":"synthetic_fixture","n":7}]
PASS  [ 7] fixture    the fixture organisation has an active user
PASS  [ 8] fixture    the fixture organisation has a vendor
PASS  [ 9] fixture    a published non-SOC2 crosswalk target exists  :: {"framework_key":"nist-csf","framework_version":"1.1","n":75}
NOTE  [10] fixture    organisation framework in use  :: {"framework_key":"nist-csf","version":"1.1","id":"28ce79ce-6f79-4996-9aa2-a080f8678369"}
PASS  [11] fixture    an extracted document was created
PASS  [12] chain      the document approves under governed review at both grains  :: {"status":200,"body":{"document":{"id":"868b624c-1550-4e1b-b5bc-be0b96bb54e7","organization_id":"b1a3da2d-5045-47c6-bd02-dec206c790fe","vendor_id":"aa0ec732-1a95-4a1e-ba4…
PASS  [13] chain      4C-2 materialised resolved tested-control resolutions  :: {"resolutions":8}
PASS  [14] vetoes     the candidate surface responds  :: {"status":200}
PASS  [15] vetoes     at least one candidate exists  :: {"candidates":9}
PASS  [16] vetoes     the surface denies coverage on every response
PASS  [17] vetoes     every candidate carries all TEN evaluated vetoes  :: {"seen":["accepted_opinion","carve_out","contradictory_evidence","control_exception","mapping_authority","open_findings","report_period","report_scope","report_type","tes…
PASS  [18] vetoes     no veto state outside PASSED / FIRED / NOT_EVALUABLE
PASS  [19] vetoes     contradictory_evidence is NOT_EVALUABLE - ADR-0012 is unbuilt  :: {"veto":"contradictory_evidence","state":"NOT_EVALUABLE","reason":"no_evidence_link_substrate","observed":{"blocked_on":"ADR-0012 evidence_links (step 2)"}}
PASS  [20] vetoes     report_period is NOT_EVALUABLE - no ratified validity policy  :: {"veto":"report_period","state":"NOT_EVALUABLE","reason":"no_ratified_validity_policy","observed":{"report_period_start":"2025-01-01","report_period_end":"2025-12-31","da…
NOTE  [21] vetoes     measured report staleness  :: {"report_period_start":"2025-01-01","report_period_end":"2025-12-31","days_since_period_end":244,"blocked_on":"ADR-0012 evidence validity (step 2) and the validity policy…
PASS  [22] vetoes     open_findings does not pass vacuously on an unpopulated dimension  :: {"veto":"open_findings","state":"NOT_EVALUABLE","reason":"open_findings_not_countable"}
PASS  [23] vetoes     report_scope resolves CC6.1 through the CATEGORY grain  :: {"veto":"report_scope","state":"PASSED","reason":"in_scope_by_category","observed":{"criterion":"CC6.1","grain":"category"}}
NOTE  [24] vetoes     candidate fan-out per tested control (Ruling 6: stays visible)  :: {"CC6.1":9}
PASS  [25] failclosed SUFFICIENT is refused while a veto is unresolved  :: {"status":409,"blocking":["report_period","tested_control_result","accepted_opinion","contradictory_evidence","open_findings"]}
PASS  [26] failclosed the refusal names contradictory_evidence as blocking
PASS  [27] failclosed direct SQL cannot store SUFFICIENT over a NOT_EVALUABLE basis  :: "new row for relation \"vendor_requirement_sufficiency_determinations\" violates check constraint \"vendor_requirement_sufficiency_fail_closed_check\""
PASS  [28] failclosed SUFFICIENT is refused when the basis COUNTS LIE about the states  :: "new row for relation \"vendor_requirement_sufficiency_determinations\" violates check constraint \"vendor_requirement_sufficiency_fail_closed_check\""
PASS  [29] failclosed a basis with NO counts key is refused, not NULL-dodged  :: "new row for relation \"vendor_requirement_sufficiency_determinations\" violates check constraint \"vendor_requirement_sufficiency_counts_present_check\""
PASS  [30] failclosed direct SQL cannot store a PARTIAL twelve-veto basis  :: "new row for relation \"vendor_requirement_sufficiency_determinations\" violates check constraint \"vendor_requirement_sufficiency_basis_completeness_check\""
PASS  [31] failclosed direct SQL cannot store an UNATTRIBUTED determination  :: "sufficiency determination for CC6.1 / ADVERSARY-3 has no attributed human reviewer"
PASS  [32] record     INDETERMINATE is recordable on exactly the blocked basis  :: {"status":200,"body":{"determined":{"id":"0ea76876-25c8-4cfa-8e3e-57536c5305a5","determination":"INDETERMINATE","indeterminate_reason":"veto_not_evaluable","determined_by…
PASS  [33] record     a determination writes NO Layer-1/2/3 row  :: {"before":{"a":1,"e":0,"x":0},"after":{"a":1,"e":0,"x":0}}
PASS  [34] record     the stored basis carries all TWELVE vetoes  :: [12]
PASS  [35] record     the determination is attributed to the deciding human
PASS  [36] record     every stored row denies coverage
NOTE  [37] record     stored veto counts  :: [{"fired":0,"passed":7,"not_evaluable":5}]
PASS  [38] record     a silent re-decision is refused  :: {"status":409}
PASS  [39] record     an explicit supersede succeeds and retains the prior row  :: {"status":200}
PASS  [40] record     history is append-only: the superseded decision is still there  :: [{"determination":"INDETERMINATE","superseded":true},{"determination":"INSUFFICIENT","superseded":false}]
PASS  [41] authority  the adversary API key fixture was actually created  :: null
PASS  [42] authority  the machine adversary IS authenticated and entitled (200 on a read)  :: {"status":200}
PASS  [43] authority  an API key holding the capability is STILL refused as non-human  :: {"status":403,"error":"human_reviewer_required"}
PASS  [44] authority  and the refusal is not an auth, consent or capability failure wearing its clothes  :: {"read":200,"write_error":"human_reviewer_required"}
PASS  [45] isolation  another tenant cannot read these candidates  :: {"status":404}
PASS  [46] isolation  another tenant cannot determine on this candidate  :: {"status":404}
NOTE  [47] corpus     extractions by tenant class  :: [{"tenant_class":"customer","extractions":5},{"tenant_class":"synthetic_fixture","extractions":13}]
NOTE  [48] corpus     live determinations estate-wide  :: [{"determination":"INSUFFICIENT","n":1}]
PASS  [49] corpus     ZERO SUFFICIENT determinations exist - the expected, ruled state  :: {"n":0}
PASS  [50] cleanup    no acceptance API key is left active  :: {"n":0}
PASS  [51] cleanup    no acceptance document remains  :: {"n":0}
```
