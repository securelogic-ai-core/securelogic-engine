# SR-024 — Affected-assets count looks wrong, or duplicate occurrences suspected

| | |
|---|---|
| **Playbook ID** | SR-024 |
| **Domain** | Vulnerability / Asset |
| **Severity default** | SEV3 (SEV2 if a report to leadership is affected) |
| **Owning level** | L1 triage → L2 |
| **Release dependency** | Requires the `develop` → `main` promotion. Unflagged. |
| **Feature flag** | None |
| **Last validated** | 2026-08-21 against `develop@58cccb2c` |
| **Status** | Diagnosis VALIDATED. No recovery needed in the common cases. |

## The vocabulary, before anything else

Most reports of "the count is wrong" are a vocabulary mismatch, not a defect. Use
these words exactly and the disagreement usually dissolves:

| Term | Counts |
|---|---|
| **Vulnerability (Finding)** | The governance object. **One** row, however many hosts it affects. |
| **Affected assets** | Distinct hosts carrying it, in any state. |
| **Occurrence / exposure** | One vulnerability on one host. The unit of remediation work. |
| **Active occurrences** | Currently observed as present. |
| **Recurring** | Stopped being reported, then reported again. History, not current state. |
| **Observation** | What one source reported about one occurrence. Two scanners agreeing is **one occurrence, two observations**. |

**One vulnerability on 500 hosts is 1 vulnerability, 500 affected assets, 500
occurrences.** It is never "500 vulnerabilities", and support must not describe it
that way — it inflates the customer's risk picture by two orders of magnitude.

## Customer-visible symptoms

- "It says 1 vulnerability but we have 500 servers affected" (correct — see above)
- "The affected count is higher than the number of hosts we scanned"
- "I think this host is listed twice"
- Active + no-longer-observed + remediated does not equal the affected total

## Likely causes

1. **Vocabulary** — see above. Most common by far.
2. **Affected includes resolved history.** A host stays *affected* after the
   exposure is remediated or no longer observed. Affected = active + absent +
   remediated, by design.
3. **The same CVE legitimately produced more than one finding** in different
   product contexts. There is deliberately **no** unique key on
   `(organization, CVE)`.
4. **A genuine duplicate occurrence is not possible** — identity is
   `(organization, finding, asset)` and the database enforces it. A second active
   occurrence for one pair cannot exist. If the customer sees the same host twice,
   they are looking at two *findings*, or at two *assets* that represent one host.

## Safe diagnostic steps

1. **Establish which number they mean.** Ask them to read the labels back.
   *(L1 OBSERVABLE.)*
2. **Check the rollup adds up**: affected = active + no-longer-observed +
   remediated. *(L1 OBSERVABLE on the finding.)*
3. **If a host appears twice**, open both rows — are the asset ids different?
   Two asset records for one real host is an **inventory** problem, not an
   occurrence problem. *(L1 OBSERVABLE.)*
4. **If two findings carry the same CVE**, that may be correct. Ask whether they
   are different products/contexts. *(L1 OBSERVABLE.)*
5. Confirming the constraint is intact is *(ENGINEERING ONLY)* — it should never
   be necessary; the database enforces it.

## Approved L1 actions

Explain the vocabulary. Show the rollup arithmetic. Where two asset records
represent one host, guide the customer to their asset inventory — that is where
the fix belongs.

## Actions L1 must NOT perform

- delete an occurrence to make a count "look right" — the count is a fact about
  exposure, and deleting the record does not change the exposure
- merge assets
- describe affected assets as "vulnerabilities" in any written reply

## Escalate when

The rollup genuinely does not add up; the same `(finding, asset)` pair appears
twice; a listed asset belongs to another organization → **SR-009, SEV1**.

## Recovery

Not applicable in the common cases. A true duplicate would be a defect →
Engineering.

## Customer communication

> "Those are two different measures and both are right. You have **one**
> vulnerability — one thing to decide about — affecting **500 assets**, which is 500
> pieces of remediation work. We keep them separate deliberately: reporting it as
> '500 vulnerabilities' to your board would overstate what you're actually dealing
> with."

## Observability

| Signal | Where | Level |
|---|---|---|
| Rollup: affected / active / no-longer-observed / remediated / recurring | Finding detail | **L1** |
| Paginated affected-asset list | Finding detail | **L1** |
| Per-occurrence history | Database | **NOT OBSERVABLE to support** |

## Related

SR-023, SR-025, SR-026 · `docs/specs/vulnerability-metrics-vocabulary.md` ·
migration `20261034`
