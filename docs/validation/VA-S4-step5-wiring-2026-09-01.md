# VA-S4 Step 5 — staging gate record, 2026-09-01

**Claim:** on staging, through legitimate product paths, SecureLogic recognizes
that a requirement already carries sufficient, current, governed assurance and
asks the vendor only what remains necessary — with every fail-closed boundary
intact.

## SHAs and runs

| Phase | Deploy | SHA | Job | Result |
|---|---|---|---|---|
| dark (flag off) | `dep-dabj7seq...` lineage, run at `dep-dabigkf...`'s predecessor state | `0fb5b58a` | `job-dabig0ou01pc73b4daug` | **22 PASS / 0 FAIL** |
| flag flip | env-only deploy `dep-dabigkf10e5c7384pveg`, same SHA | `0fb5b58a` | — | flag on, code identical |
| fix-forward | PR #973 (read-time conflict guard) | `dd25073f` | — | 8/8 CI |
| active (flag on) | `dep-dabj7seq1p3s73ad51p0` | `dd25073f` | `job-dabjdbfavr4c738j62h0` | **19 PASS / 0 FAIL** |

PRs: #972 (step 5: counting predicate `assurance-coverage-1.0`, evaluator
`sufficiency-veto-1.1`, ADR-0012 §5 dual-read, reviewer surface), #973
(read-time conflict guard, found live by this acceptance).

## What was proven, phase by phase

**Dark.** The full governed chain through routes — approve → accept opinion →
accept effectiveness → resolve open findings' remediation actions → close the
findings → **the first SUFFICIENT ever recorded on staging, twelve vetoes all
PASSED** → engagement created through intake → the reviewer SEES coverage
(`GET /vendor-engagements/:id/assurance-coverage`, covered=1, valid_until
2026-12-31) → **scope composition unchanged** (full depth, no S4 reason) → the
dual-read PERSISTED in the audit record: `computed: true, applied: false,
covered_count: 1`. That record is the ADR-0012 §5 divergence evidence: output
identical while the predicate ran.

**Active.** Same SHA family, flag on: the covered requirement is **REDUCED to
depth "confirm" — asked, not skipped** — with the decision basis
(determination id, document, valid_until, validity source, predicate version,
as-of) riding the scope item's own reason. Then a superseding INSUFFICIENT
through the route: coverage withdrawn at once, the re-resolve asks IN FULL
again, and the historical SUFFICIENT survives — superseded, basis intact,
twelve vetoes readable.

## What the acceptance FOUND (the reason it exists)

1. **`open_findings` refused the first determination** — the fixture org held
   an open finding with no control attribution. The customer-operable
   resolution was exercised, not bypassed: complete the remediation ACTION
   (linked as `source_type='finding'`), then close the finding past the closure
   gate. Fail-closed, resolved through the product.
2. **A real product gap: conflicting judgements at READ time.** A harness
   accident left a live INSUFFICIENT beside a live SUFFICIENT (reverse order
   the write-time veto cannot catch) — and coverage kept counting. Fixed in
   #973: the predicate excludes the conflicted requirement AND surfaces it as a
   `conflicting_governed_judgement` gap. The subsequent run then passed its
   withdrawal checks *through the new guard* before the harness was even
   corrected — the guard was observed working live before its targeted test ran.

## Boundaries reasserted

Applicability never disappears because evidence exists (the requirement stayed
in scope in every phase); floors and compliance protection are enforced by the
pre-existing resolver semantics this wiring only feeds; AI proposed and humans
decided at every hop (opinion, effectiveness, determination); no override path
exists; the kill switch is the flag, and the dark phase IS the kill-switch
state, proven byte-identical.

## Scope discipline

No production change, no Blueprint sync, no promotion to main, no production
flag touched. `SECURELOGIC_EVIDENCE_LIFECYCLE_V2` is ON for the STAGING engine
only.
