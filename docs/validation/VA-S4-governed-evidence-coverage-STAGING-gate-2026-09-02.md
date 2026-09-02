# Governed-evidence coverage surface — staging gate record

**Date:** 2026-09-02
**Package:** VA-S4 governed-evidence coverage surface + dark-surface gate hardening
**Authority:** owner direction 2026-09-02 — remediate the audit gate, then #980, then #981, then acceptance
**Result:** **29 PASS / 0 FAIL** at `develop` `05cb7a4a`
**Production:** **untouched.** No promotion, no migration, no flag, no new capability.

---

## 1. What was merged, in the order the owner set

Squash merges are disabled on this repository; every merge below is a merge
commit through the protected process, with required CI green **at the exact
reconciled head**, not at an earlier one.

| # | PR | Head merged | CI | `develop` after |
|---|---|---|---|---|
| 1 | **#982** fast-uri lockfile remediation | `c44c5076` | 8/8, **`audit=success`** | **`972f432e`** |
| 2 | **#980** production promotion record | `abdfccbe` | 8/8 | **`9e0368fb`** |
| 3 | **#981** coverage surface + gate hardening | `fa377f62` | 8/8 | **`782e9503`** |
| 4 | **#983** acceptance-harness repair | `a5cd4ed8` | 8/8 | **`05cb7a4a`** |

#980 and #981 were both **reconciled onto the new head** before merging (GitHub
update-branch), so each ran a fresh full CI on the code that actually landed.

## 2. The audit gate, and a correction worth keeping

The `audit` gate had been failing on **every** branch since four HIGH fast-uri
advisories published between **15:41Z and 15:44Z**. The first reading of that
blocker — recorded earlier the same day — was that the advisories were *patched
only in 4.x* and that *no ajv release accepts fast-uri 4.x*, so it needed an
override-past-semver or a named waiver and therefore an owner ruling.

**That reading was wrong, and it held the whole train.** GitHub had since
recorded the backport ranges: all four are also patched in **3.1.6**, and
`fast-uri@3.1.7` ships under the `three` dist-tag. `ajv@8.18.0` declares
`fast-uri: ^3.0.1`, which 3.1.7 satisfies. The fix was two hunks in the
lockfile — `package.json` untouched, no `overrides`, and
`.audit-waivers.json` still `"waivers": []`.

The timing is legible in CI and worth stating plainly: **#980's `audit` passed
at 15:48Z and #981's failed at 16:36Z on a byte-identical lockfile**
(`349e4780`). #980 was not clean; it was early. A green `audit` from an earlier
run proves nothing about now.

> **Carried forward:** production `main` `d42acbac` still resolves
> `fast-uri@3.1.5`. The remediation is on `develop` only and reaches production
> on the next promotion. Recorded, not fixed here — no production change was
> authorized in this cycle.

## 3. Staging deployments

| Deploy | Commit | Finished |
|---|---|---|
| `dep-dac788jbc2fs73f91rs0` | `782e9503` | 2026-09-02T19:10:09Z |
| `dep-dac814flk1mc73ak33gg` | **`05cb7a4a`** | 2026-09-02T20:03:25Z |

`securelogic-engine-staging` (`srv-d7n0rju8bjmc738jbs7g`) tracks `develop`,
autoDeploy on. `SECURELOGIC_EVIDENCE_LIFECYCLE_V2` = **`true`** on staging.

## 4. Acceptance — every run, including the ones that failed

The first run failed. It is recorded here in full, because the two arms that
*passed* in it were the more serious problem.

| Run | Job | Code under test | Result |
|---|---|---|---|
| 1 | `job-dac79gfqj5pc739v0f5g` | committed harness @ `782e9503` | **23 PASS / 3 FAIL** |
| — | `job-dac7afp1a67c7388mtr0` | read-only diagnostic | root cause |
| 2 | `job-dac7f7bm8hqs73a5b6fg` | injected fix 1 | 27 / 2 |
| 3 | `job-dac7gt710e5c73fr1ot0` | injected fix 2 | 27 / 2 |
| 4 | `job-dac7hoid0e5s73fr6ke0` | injected fix 3 @ `782e9503` | **29 / 0** |
| 5 | **`job-dac829dg1s2s73e59l70`** | **committed harness @ `05cb7a4a`** | **29 PASS / 0 FAIL** |

Runs 2–4 were injected via gzip+base64 into the start-command, which does not
move the deployed SHA. Run 5 is the one that counts: the **committed** harness,
executed from the deployed image, at the exact merged head.

### 4.1 What was actually wrong — three harness defects, no product defect

**(a) The fixture engagement was never tiered, so `POST /scope` answered 500.**
`resolveScope` mirrors the thirteen inherent-risk facts into the canonical fact
store (VA-Q2 P3) before resolving anything, and `writeFacts` rejects a null:

```
FactStoreValidationError: assessment_facts: invalid fact at index 0:
  value: core.data_sensitivity must be a string
    at mirrorInherentFacts (factStore.js:182)
    at resolveScope (vendorEngagements.js:569)
```

Reproduced on an engagement with **zero** governed evidence
(`job-dac7afp1a67c7388mtr0`), and the throw is upstream of every S4 line. The
fixture, not the surface.

**(b) The depth arm read fields the route does not return — and so could not
fail.** `POST /scope` returns `{ scoped, excluded, tier, scope_rule_version,
truncated, composition }`. The harness read `json.requirements` and
`json.assuranceCoveredRequirementIds`. Neither exists;
`assuranceCoveredRequirementIds` is an **input** to the resolver, never an
output. Both reads yielded `0` and `[]` unconditionally, so *"QUESTION DEPTH IS
IDENTICAL"* compared `0 === 0` and **would have passed whatever the product
did**. This is the defect that mattered: it was reported as a pass in run 1.

**(c) The cross-tenant arm never reached tenant scoping.** Three shapes of one
failure, each exposed by fixing the last:

| foreign-tenant selection | outcome | what it actually proved |
|---|---|---|
| oldest organisation | zero active users → arm **skipped**; 21 and 22 never ran | nothing |
| oldest with an active user | **403 `consent_required`** (`requireConsent`) | a consent gate works |
| + an api key | **401 `no_active_api_key`** (`requireApiKey`) | an auth gate works |

A check written `403 || 404` accepted the second. The foreign tenant is now
**built by the harness** — its own organisation, an active user, that user's
legal consents copied from the fixture owner, and an active api key — so it
reaches the engagement lookup and is refused **by tenant scoping**.

## 5. What run 5 proves, claim by claim

| Owner's requirement | Evidence at `05cb7a4a` |
|---|---|
| current governed non-SOC evidence appears at requirement grain | pen test visible with `requirement_reference` **`GE-A`**; ISO cert and privacy agreement at **`GE-B`** (checks 6–8, 11–12) |
| non-tested-control evidence stays explicitly **NON-COUNTING**, deterministically | `counts === false` on **every** row (13); reason **`no_tested_control_authority`** (10–12); repeated reads byte-identical (15) |
| the reason is not a mislabel | `soc2_type2` reports **`awaiting_sufficiency_determination`**, not "lacks authority" (14) |
| questionnaire depth reduction from these classes is **exactly ZERO** | **67 → 67** on a `tier_1_critical` questionnaire, and the **frozen question set identical by id** from `vendor_engagement_scope_items` (3, 3.1, 24, 25, 26) |
| stale/expired evidence cannot masquerade as current | expired **absent**; `not_established` **absent**; unconfirmed **absent**; detached **leaves** (16–19) |
| cross-tenant evidence cannot surface | foreign tenant, past consent and past api-key, gets **404 `engagement_not_found`** with no `governed_evidence` in the body (20–22); anonymous **401** (23) |
| existing SOC sufficiency behaviour unchanged | `covered[]` **0 → 0** (27); no governed-evidence requirement id in `covered[]` (29); counting version still **`assurance-coverage-1.1`** (28) |
| no `INAPPLICABLE` veto state introduced | the token appears **only in comments** stating it was deliberately not introduced — no code path, verified by grep on `develop` |
| the 401→404 regression has a deterministic flag-off test | `evidenceLifecycleFlagOff.test.ts`, **13 tests passing**, including an assertion on the `GATE` array order itself |

The flag-off **404** cannot be observed on staging, because the flag is ON
there — with it on, the surface is live and still refuses an anonymous caller
with **401** (check 30). The unit suite owns the 404 proof, and says so.

## 6. Production

| Fact | Value |
|---|---|
| Live deploy | `dep-dac48bfqj5pc73dr7ud0`, **`d42acbac`**, finished 15:45:33Z — **unchanged all session** |
| `SECURELOGIC_EVIDENCE_LIFECYCLE_V2` | **absent** |
| Dark substrate paths, unauthenticated | **401**, exactly as recorded in #980 |

The 401 on production is expected and unchanged: the `GATE` reorder that makes
those paths answer a bare 404 is on `develop` only. Production received **no new
capability activation**, and the coverage surface is not reachable there.

## 7. Status

The coverage extension is **staging-accepted at `05cb7a4a`** and **dark in
production**. It is not promoted, and nothing here authorizes promoting it.
