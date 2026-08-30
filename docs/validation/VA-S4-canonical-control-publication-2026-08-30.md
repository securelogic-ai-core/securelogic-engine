# VA-S4 Step 1 — canonical control publication record (staging)

Environment: **staging** (`securelogic-engine-staging`, db `securelogic-staging-db`).
Code: `develop` `932db635` (PR #938), staging engine deployed 2026-08-30 12:04 UTC.
Schema: migrated through `20261069_control_canonical_identities.sql` (265 migrations).

This file records a **governance act**: the publication of canonical control
content under a named human. Published rows are frozen by database trigger, so
the expectation is recorded *before* the act and verified *after* it.

---

## 1. Pre-publication state (verified 2026-08-30 12:04 UTC)

| Table | Rows |
|---|---|
| `canonical_controls` | 0 |
| `canonical_control_aliases` | 0 |
| `canonical_control_crosswalk` | 0 |
| `control_canonical_identities` | 0 |
| `canonical_framework_versions` | 18 (backfilled by `20261068`, includes `nist-csf 1.1` **and** `nist-csf 2.0`) |

The four publication tables shipping empty is the designed dark ship: no
migration publishes canonical content, and the publication-authority CHECK makes
a published row without a named `users` id impossible.

## 2. Authoritative dry-run expectation

Source: `scripts/publish-canonical-controls.ts` (dry run is the default; it
executes every real statement inside a transaction against the live constraints
and then ROLLBACKs, so these counts are constraint-backed, not simulated).

Run: `job-daa1oi1srm7s73dlnc50`, 2026-08-30 12:04:49 UTC, exit **0**.

| Field | Value |
|---|---|
| `corpus_version` | `2026.08.1` |
| `controls_published` | **45** |
| `controls_already_published` | 0 |
| `aliases_inserted` | **54** |
| `aliases_already_present` | 0 |
| `crosswalk_published` | **75** |
| `crosswalk_already_present` | 0 |
| `framework_versions_inserted` | **0** |
| `drift` | none (`[]`) |
| `crosswalk_drift` | none (`[]`) |
| `alias_conflicts` | none (`[]`) |

`framework_versions_inserted: 0` is correct rather than suspicious: migration
`20261068` already created the 18 version rows, so the crosswalk binds to an
existing `nist-csf 1.1` row instead of manufacturing one.

## 3. Why this differs from the earlier preliminary estimate (46 controls / 58 crosswalk rows)

The earlier estimate is **not** overwritten — it is reconciled here. Neither
figure was a curation change: the corpus modules have exactly one commit in
history (`7687d11e`), so no content was added or removed between the estimate
and this run. Both deltas are counting-grain artefacts.

**46 → 45 controls.** The 46 came from a line-grep of `canonicalControlCorpus.ts`
for `slug:`. That file contains 45 corpus entries **plus one further `slug:`
occurrence that is not a control**: the `readonly slug: string;` field
declaration on the `CanonicalControlDefinition` type. Parsing the array itself
yields 45 entries, 45 unique slugs. **45 is correct**; 46 counted the type
definition as a control.

**58 → 75 crosswalk rows.** These are two different grains:

- `NIST_CSF_1_1_CROSSWALK` holds **57 entries**, one per NIST CSF 1.1
  `requirement_reference` (57 unique references — all 57 the shipped
  `FRAMEWORK_TEMPLATES.nist_csf` template actually creates).
- A published `canonical_control_crosswalk` row is one **(requirement,
  canonical control) pair**, not one entry. **18 of the 57 entries map to more
  than one canonical control** (e.g. `ID.BE-4` needs both a business impact
  analysis and an external dependency inventory).
- 57 entries + 18 extra pairs from the many-to-many entries = **75 rows**.
  This matches the PR #938 claim ("all 57 references the shipped template
  actually creates, 18 of them many-to-many") exactly.

An estimate at the **entry** grain lands near 57–58; the **row** grain is 75.
Stated honestly: 57 (entries) and 75 (rows) are both reproducible from the
module, and **58 is not** — it corresponds to no structure in the file. Its most
likely origin is an entry-grain count off by one, but that provenance is
inferred, not verified, and no earlier revision of the module exists to check it
against. The number to carry forward is **75 rows / 57 requirements**.

One further honest count, unchanged by any of this: **one canonical control
(`segregation-of-duties`) appears in the corpus and in no crosswalk row.** That
is deliberate — a canonical control is not a framework requirement — and it means
45 controls with 44 of them reachable from NIST CSF 1.1.

## 4. Publication (`--apply`)

- Publisher: `securelogicaitest@gmail.com` (`cc490d5b-19ce-4819-a55e-7d9375c98e7e`),
  the existing staging admin. Staging has no `info@securelogicai.com` user; this
  identity is staging-only and does not carry to production.
- Production canonical content was **not** published. No promotion, no Blueprint
  sync.

_(Result appended below after the run.)_

### Result — APPLIED, 2026-08-30 12:11:14 UTC

Job `job-daa1r8ss728c73f4t88g`, exit 0. Persisted state matches the dry run
**exactly**:

| Field | Dry run | Persisted |
|---|---|---|
| canonical controls | 45 | **45** |
| aliases | 54 | **54** |
| crosswalk rows | 75 | **75** |

Provenance, verified directly rather than inferred from the script's own output:

- **`canonical_controls`** — 45/45 `status='published'`, 45/45
  `published_by_user_id = cc490d5b-19ce-4819-a55e-7d9375c98e7e`, 45/45
  `published_at = 2026-08-30 12:11:14.310378+00` (one timestamp for all 45 —
  a single atomic act), 45/45 keys in the `securelogic:control:` namespace,
  0 superseding rows.
- **`canonical_control_aliases`** — 54 rows, 54 distinct `alias_key`, all
  `alias_scheme='industry_template'`, covering 26 of the 45 canonical controls.
- **`canonical_control_crosswalk`** — 75 rows, all
  `published / securelogic / 2026.08.1`, `proposed_by_actor_kind =
  securelogic_curator`, `approved_by_user_id = cc490d5b…`, 75/75 with
  `approved_at`, 75/75 live (`superseded_at IS NULL`), 57 distinct requirement
  references, exactly 1 `(framework_key, framework_version)` pair.
- **Audit** — one `canonical_control.published` row in `security_audit_log`,
  actor `cc490d5b…`, `organization_id` NULL (platform-level),
  payload `{corpus_version: 2026.08.1, controls_published: 45,
  aliases_inserted: 54, crosswalk_published: 75}`.

No production content was published. No promotion, no Blueprint sync.

---

## 5. End-to-end chain proof (staging)

Org: **`Enterprise Validation StageA`** (`f70267ce-6458-49fa-8670-d33342fba24c`),
which had NIST CSF 1.1 activated with 57 requirements, 1 control, 0 identities,
0 evidence. Job `job-daa1ugu7bikc73f6vhb0`, exit 0.

The tenant arm had to be created, because **no staging org had a single
template-derived control** — so `control_canonical_identities` had no way to be
populated. It was created through the **real code path**, not by fixture SQL:
`loadTemplate(org, 'healthcare-saas', {selectedItemIds})`, whitelisted to the 30
of the template's 38 controls whose `TemplateControl.id` is a registered alias
of a published canonical control.

**The new write fired for the first time in a real environment:** 30 controls
inserted, 0 skipped → **30 `control_canonical_identities` rows, all provenance
`template`**.

### Hop counts

| Hop | Count |
|---|---|
| 1. applicable requirements (NIST CSF 1.1, this org) | 57 |
| 2. resolvable versioned requirement identity | 58 |
| 3. requirements matched by a published, non-superseded crosswalk row | **57 / 57** |
| 4. distinct published canonical controls reached | **44** (of 45) |
| 5. requirements that reach a tenant control | **34** |
| 5. distinct tenant controls reached | 30 |
| 6. eligible evidence | see below |

44 of 45 is correct, not a shortfall: `segregation-of-duties` is deliberately in
the corpus and in no crosswalk row — a canonical control is not a framework
requirement.

### Terminus

Two fixture rows were created on this org, both titled `[VA-S4 CHAIN PROOF]` so
they are identifiable and removable: one `control_assessments` row against the
chain-resolved control, and one `evidence` row
(`source_type='control_test'`, `requirement_id` set).

- `control_assessments.id` = `b78aa6c5-82b4-422c-8297-d8bb752c29d1`
- `evidence.id` = `817adcb6-d1aa-4ca3-9ea3-9baa4b0f306d`

**These two rows were deleted on 2026-08-30 — see §7.** The result recorded here
is what the run produced and is not amended; §7 records the removal and what is
still reproducible without them.

The full chain then resolves live:

```
DE.AE-1  ->  nist-csf 1.1  ->  published/securelogic/2026.08.1
         ->  securelogic:control:secure-baseline-configuration
         ->  [template]  ->  "File integrity monitoring on ePHI repositories"
         ->  evidence 817adcb6 "[VA-S4 CHAIN PROOF] test result" (test_result)
```

**Every hop is a real row. The chain is proven.**

### The finding this proof surfaced

The end-to-end query returned **three** rows, not one: `DE.AE-1`, `DE.CM-5` and
`PR.IP-1` all resolve through the same canonical control to the same tenant
control and therefore to the **same single evidence record**.

That is the control→requirement fan-out the wiring plan flagged as open question
§2 #5 ("Does covering a control cover every requirement it maps to? Almost
certainly **no**"), now demonstrated with live rows rather than argued. One
control test is not automatically evidence for every requirement its canonical
control maps to. **This must be answered before `S4.assurance` is wired**, or
S4 will reduce depth on requirements no one actually evidenced.

### Gap: only one writer exists

`templateLoader` is the **only** writer of `control_canonical_identities`.
Nothing writes provenance `attestation`, `customer_mapped` or `inferred` — there
is no route, no service, no script. A control created by hand (the normal case
for an existing tenant) can acquire a canonical identity by **no means at all**
today. See §6 for why that immediately matters.

## 6. Read-only S4 predicate re-run — still DEAD

Per the wiring plan's own gate ("re-run the read-only validation of §3; if it
still reports zero eligible requirements, **stop**").

Corpus, staging-wide:

| | |
|---|---|
| `vendor_assurance_documents` | 57 |
| — `processing_status='finalized'` | **0** |
| — `assurance_opinion` extracted | 0 |
| — opinion human-accepted | 0 |
| — `approved_at` set | 2 |
| `vendor_assurance_cuecs` | 9 (0 accepted) |
| CUEC→control mappings | 10 (3 accepted) |
| `control_mappings` | 33 (3 before this proof; +30 written by the template load) |

Predicate result, staged by clause: `join only` **0**, `+accepted mapping` 0,
`+accepted CUEC` 0, `+finalized document` 0.

**It dies before any eligibility clause is applied** — the bare structural join
is already empty. Isolating each hop: documents→CUECs 9, CUECs→mappings 10,
mappings→controls 10 (10 same-org), **controls→`control_mappings` 0**.

So the terminal break is the **control→requirement hop**, which is exactly the
deficiency Ruling 1 named in `control_mappings` ("no organization_id, no
provenance, no version, no source, no approval state"). Publishing the crosswalk
is the right direction — but the predicate must be **re-pointed** at it to
benefit, and re-pointing alone is not enough:

**Counterfactual measured, not assumed.** The same predicate routed through the
governed crosswalk (`control_canonical_identities` → `canonical_controls` →
`canonical_control_crosswalk` → `requirements`) also returns **0**. Two
independent reasons, each sufficient:

1. all 5 CUEC-mapped controls belong to `Staging Inc` and are **hand-created**,
   so they carry no canonical identity — and Ruling 1 forbids manufacturing one;
2. `Staging Inc`'s only activated framework is **NIST SP 800-53 Rev 5**, which
   the curated corpus does not cover (NIST CSF 1.1 only).

**Verdict: the predicate is still DEAD, and the cause is population and corpus
coverage — not the predicate and not the crosswalk.** The gate says stop, so
S4 was not wired. Three things must change first: finalized VA documents with
human-accepted opinions; a way for a hand-created control to acquire a canonical
identity (§5's missing writer); and crosswalk coverage of the frameworks the
orgs holding assurance evidence actually run.

---

## 7. Fixture ledger — SYNTHETIC, TEST-ONLY, TEMPORARY — **REMOVED 2026-08-30**

The two rows the chain proof created were **synthetic validation fixtures**.
They were **not** canonical proof data, **not** customer assurance evidence, and
**not** a permanent artefact of the platform.

**Both were deleted on 2026-08-30, immediately after PR #939 merged
(`245fcf1a`)** — by owner decision, rather than being retained until the §2d
prerequisites were resolved. Deletion was two scoped `DELETE`s by primary key
inside one transaction, evidence first and then the control assessment,
following the FK direction. A scope check first confirmed these were the only
two `[VA-S4 CHAIN PROOF]`-labelled rows in the database.

This section is kept, not deleted: the fact that the 2026-08-30 end-to-end
result rested on fixtures is part of the result.

| | |
|---|---|
| **Organization** | `f70267ce-6458-49fa-8670-d33342fba24c` — `Enterprise Validation StageA` (**staging only**) |
| **Created** | 2026-08-30, job `job-daa1ugu7bikc73f6vhb0` |
| **Created by** | VA-S4 Step 1 staging chain proof (injected script, not committed) |
| **Purpose** | Populate the terminal hop of the chain — `tenant control → eligible evidence` — so the end-to-end join returns rows instead of proving only the first five hops |
| **Status** | **SYNTHETIC / TEST-ONLY.** Fabricated for validation. Asserts nothing about any real control, vendor, auditor or customer |
| **Label** | Both titled `[VA-S4 CHAIN PROOF]` so they are greppable and removable |
| **Removed** | **2026-08-30**, after PR #939 merged (`245fcf1a`). Two `DELETE`s by primary key in one transaction, verified 0 rows remaining |

### Exact identifiers

Struck rather than removed, so the record of what was created stays legible.

| Table | id | Detail | Status |
|---|---|---|---|
| `control_assessments` | ~~`b78aa6c5-82b4-422c-8297-d8bb752c29d1`~~ | `status='passed'`, control `108f720d-97bb-4ebb-b637-f6c3c2510bab` ("File integrity monitoring on ePHI repositories") | **DELETED 2026-08-30** |
| `evidence` | ~~`817adcb6-d1aa-4ca3-9ea3-9baa4b0f306d`~~ | `source_type='control_test'`, `source_id` = the row above, `evidence_type='test_result'`, `requirement_id=e355f6d9-d741-4586-b946-eb223dc7e217` (`DE.AE-1`) | **DELETED 2026-08-30** |

### Retained by owner decision — the template-loaded data

Also created on the same org by the same job: **30 controls**, **30
`control_canonical_identities`** rows from the whitelisted `healthcare-saas`
template load, and the **30 `control_mappings`** rows that load wrote (taking
staging from 3 to 33).

**These were deliberately RETAINED**, and the distinction is the point: they
were not fabricated. They were written by the **real `templateLoader` code
path** on a staging validation org — the same path a real tenant runs — so they
are ordinary template data rather than a fixture, and they are what keeps hops
1–5 of the chain reproducible against live rows. They remain staging-only and
are still not customer data.

### Handling rules

1. **Never treated as customer assurance evidence.** This evidence record must
   not contribute to any assurance-coverage decision, any S4 depth reduction, or
   any customer-facing assertion of control effectiveness.
2. **Excluded from normal product metrics.** Any posture score, coverage
   percentage, evidence count, dashboard tile or executive report computed over
   staging must be read with this org's fixtures subtracted, or the org
   excluded. A staging metric that includes them is measuring a fabrication.
3. **Staging only.** Nothing here exists in production, and nothing here may be
   copied, promoted or seeded into production.
4. **Cleanup is REQUIRED, not optional. — DISCHARGED 2026-08-30.** Both rows
   were deleted, earlier than the deadline this rule set (before S4 staging
   acceptance, wiring-plan §7 step 7). The reasoning stands for anything that
   replaces them: an acceptance run that passes on fixture evidence is a vacuous
   pass, the exact failure mode the plan's gate exists to prevent. **No fixture
   evidence may be created to satisfy that acceptance.** This rule no longer
   describes an outstanding obligation for the two deleted rows; it does still
   govern the retained template data if that is ever to be reversed.
5. **Cleanup order** follows the FK direction: `evidence` → `control_assessments`
   → (if the template load is also being reversed) `control_canonical_identities`
   → `control_mappings` → `controls`. `control_canonical_identities.control_id`
   is `ON DELETE RESTRICT`, so a control cannot be removed while its identity
   row stands.
6. **This ledger is the record of what to remove. — EXECUTED 2026-08-30.** The
   ids are struck above rather than removed, and this section is kept, exactly
   as this rule required.

### Post-deletion verification (2026-08-30)

Re-measured against staging after the two `DELETE`s, so this record describes
the state a reader will actually find:

| Hop | Before | After |
|---|---|---|
| 1. applicable requirements (NIST CSF 1.1) | 57 | **57** |
| 5. requirements reaching a tenant control | 34 | **34** |
| 5. distinct tenant controls reached | 30 | **30** |
| `control_canonical_identities` on the org | 30 | **30** |
| **6. eligible evidence** | 1 | **0** |

**Hops 1–5 remain reproducible on demand against live rows.** The end-to-end
row is not, and will not be until prerequisite C (§2d of the wiring plan) lands
genuinely governed assurance state on this org. That is the intended trade: the
chain's mechanism stays provable, and the terminus waits for real evidence
rather than a fabrication.
