# SR-026 — "The scan didn't close anything" / absence disagreement

| | |
|---|---|
| **Playbook ID** | SR-026 |
| **Domain** | Vulnerability / Asset |
| **Severity default** | SEV3 |
| **Owning level** | L1 triage → L2 → Engineering |
| **Release dependency** | Requires the `develop` → `main` promotion. Unflagged. |
| **Feature flag** | None. **No scanner connector exists (SL-OCC-3 not built)** — observations arrive only via authorized import. |
| **Last validated** | 2026-08-21 against `develop@58cccb2c` |
| **Status** | Diagnosis VALIDATED. **No recovery procedure — SUP-PROC-1.** |

## The rule this runbook exists to explain

> **Missing from a scan does not mean fixed.**

A vulnerability leaves a report for many reasons: it was remediated, the host was
powered off, credentials expired, the scan template changed, or the asset simply
was not in that run's scope. **Only the first is good news, and a report cannot
tell them apart.**

So SecureLogic never infers absence from a vulnerability being missing. It infers
it from **an asset being present in a completed scan that declared its scope**,
combined with the vulnerability not being reported against that asset.

**Three conditions, all required:**

| Condition | Why |
|---|---|
| The run **completed** | An aborted run proves nothing about what it never reached |
| The run **declared its scope** | It said what it *looked at*, not just what it *found* |
| The asset was **in that scope** | Otherwise nothing was looked at, and silence is not evidence |

If any is missing, nothing is marked absent — and the platform records **why**.

## Customer-visible symptoms

- "We ran a clean scan and nothing closed"
- "This host was scanned but the vulnerability still shows as active"
- "Why is this still listed when it's gone?"

## Impact

None to data integrity. The exposure record is intentionally conservative: it
over-reports rather than under-reports, because the failure mode of the opposite
is reporting remediation that never happened.

## Likely causes

1. **The scan did not declare its scope.** Then it is good evidence of presence and
   *no* evidence of absence — by design, and the default.
2. **The run did not complete.**
3. **The asset was not in the declared scope** — the run never looked at it.
4. **Another source still reports it.** Staleness is per-source: one scanner going
   quiet does not silence another. The exposure stays active until *every* source
   that reported it has gone quiet against a scan that covered the asset.
5. **The occurrence is `remediated`** — a recorded remediation is never overturned
   by a scanner going quiet, so it will not flip to absent.

## Safe diagnostic steps

1. **Ask how the observations were supplied**, and whether the scope was declared.
   *(L1 OBSERVABLE via the customer.)*
2. **Ask whether the specific host was in that run.** *(L1 OBSERVABLE.)*
3. **Check the occurrence's current presence** on the finding. *(L1 OBSERVABLE.)*
4. **Ask whether more than one source reports this exposure.** *(L1 OBSERVABLE
   via the customer; the observation ledger itself is not support-visible.)*
5. Reading the run's recorded skip reason is *(L2/ENGINEERING ONLY)* — the engine
   logs exactly why it declined to mark anything absent.

## Approved L1 actions

Explain the rule. Confirm whether the customer expects a scope-declared run.
Escalate to L2 to read the recorded reason.

## Actions L1 must NOT perform

- mark occurrences absent to reflect what the customer believes — **absence is an
  observation, not an opinion**, and the API deliberately refuses to let a person
  set it
- mark them remediated instead, as a workaround — that asserts work was done
- describe the behaviour as a bug

## Escalate when

The customer supplied a completed, scope-declared run covering the asset, the
vulnerability was not reported, and the occurrence is still active. That would
contradict the reconciliation rule and needs Engineering.

## Recovery

**None validated (SUP-PROC-1).** Reconciliation is engine-owned; there is no
support-executable path.

## Recovery verification

After a qualifying run, the occurrence shows **No longer observed** and the rollup
moves accordingly. Note: this does **not** close the Finding — see SR-025 §C.

## Customer communication

> "A clean scan doesn't automatically clear a vulnerability here, and that's
> deliberate. Something can disappear from a report because it was fixed — or
> because the host was offline, credentials expired, or it wasn't in that scan's
> scope. We only mark it as no-longer-observed when we know the scan actually
> covered that host and didn't find it. Otherwise we'd be telling you things were
> fixed when they might not be."

## Observability

| Signal | Where | Level |
|---|---|---|
| Occurrence presence state | Finding detail | **L1** |
| `vulnerability_reconcile_skipped` **with the exact reason** | Engine logs | L2 |
| `vulnerability_reconcile_complete` counters | Engine logs | L2 |
| Scan run status, scope_declared, covered assets | `vulnerability_scan_runs` / `_assets` | **NOT OBSERVABLE to support** |

**Missing:** there is **no customer- or support-visible scan-run history**. "What
did the last run cover, and why didn't it close anything?" is answerable only from
engine logs today, and it is the central question of this runbook
(**SUP-OBS-10 — highest-value gap in the vulnerability domain**).

## Related

SR-025, SR-024 · `src/api/lib/observationReconciliation.ts` (`absenceAuthority`) ·
migration `20261035`
