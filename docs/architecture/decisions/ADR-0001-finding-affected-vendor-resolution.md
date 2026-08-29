# ADR-0001 — Finding "affected vendors" resolution for matcher-created (CVE) findings

- **Status:** PROPOSED — awaiting product/architecture ruling. **Do not implement or merge as ratified.**
- **Date:** 2026-07-10
- **Context package:** Workflow-consistency remediation, Phase 2. Raised by the
  staging defect *"third-party impact says no affected vendors despite a Microsoft
  vendor-linked CVE."*
- **Decider:** product owner (this ADR exists to obtain that decision).

This ADR does **not** change code. It documents the current contract and asks a
single ruling, because the "fix" touches the canonical model rather than a local
bug.

---

## 1. The observed symptom

A cyber-signal (CVE) whose `affected_vendor` is e.g. "Microsoft" produces a
Finding in an org that has Microsoft in its vendor inventory. The Decision
Workspace shows **"Affected vendors: None"** and the **Third-party** business-impact
dimension reads **None**, even though the finding exists *because* the matcher
recognized the vendor. To a user this looks broken.

## 2. Current affected-vendors contract (verified in code)

`GET /api/findings/:id/context` → `src/api/lib/findingContextResolver.ts:339-365`
resolves affected vendors **exclusively** from the org-scoped `signal_vendor_links`
table (soft-delete-aware), joined to the org's `vendors`:

```
affected("signal_vendor_links", "vendor_id", "vendors", "name", "vendor")
  → JOIN vendors e ON e.id = l.vendor_id AND e.organization_id = l.organization_id
    WHERE l.organization_id = $org AND l.signal_id = ANY($signalIds) AND l.deleted_at IS NULL
```

That vendor count then feeds `assessBusinessImpact(...)`
(`findingContextResolver.ts:381-389`), so **Third-party impact is a direct
function of accepted `signal_vendor_links`.** The `"No affected vendors"` note is
`src/api/lib/findingRiskScore.ts:124-127` when the count is 0.

**Rows in `signal_vendor_links` are created only on human acceptance** of a
suggestion (`src/api/routes/signalMatchSuggestions.ts:555-566`) or a manual POST
(`src/api/routes/signalVendorLinks.ts:166`). The matcher does **not** write them.

## 3. Canonical asset-matching path (verified)

At signal ingest, `runMatcherForSignal(signal, orgId)`
(`src/api/lib/cyberSignalProcessingService.ts`) canonically matches the signal's
`affected_vendor` string against the org's **active** vendors using
`canonicalizeVendorName` (`:213-235`) — a normalize-then-**EXACT** comparison
(lowercase, non-alphanumeric→space, strip trailing legal suffixes; compared with
`===`, no substring/fuzzy step; short names cannot leak). On a hit it writes:

1. a **Finding** (`source_type='cyber_signal'`, `:459-498`), and
2. a **`signal_match_suggestion`** (pending, score 0-100, `:598-619`).

It deliberately does **not** write `signal_vendor_links`. The suggestion is the
matcher's output; the link is the *human triage* output.

There is a second, unrelated resolution path — the predictive/insights
aggregation `POST` route at `src/api/routes/intelligence.ts:603-614` — which joins
`vendors v ON v.name ILIKE cs.affected_vendor`. That is a **wrong join**:
`ILIKE` without wildcards is whole-string case-insensitive equality, so
"Microsoft Corporation" (vendor) ≠ "Microsoft" (signal). It is stricter than the
canonical matcher and silently drops legitimately-matched vendors — but it feeds a
different surface (insights/attack-surface), not the Decision Workspace.

## 4. Source of truth for vendor attribution

| Concern | Source of truth |
|---|---|
| "Which vendor does this signal name?" | `cyber_signals.affected_vendor` (free text from the feed) |
| "Does this org use that vendor?" | `canonicalizeVendorName` match vs org's **active** `vendors` (the matcher, at ingest) |
| "Is this vendor an *accepted* affected party for this finding?" | `signal_vendor_links` (written only on human accept) — **the current affected-vendors contract** |
| "Is there a *pending* suggested match?" | `signal_match_suggestions` (pending), already surfaced in the `/queue` Review Links |

So today the Decision Workspace answers with the **accepted-link** source of
truth, while the **match-at-ingest** evidence and the **pending suggestion** both
already exist and are unused by that surface.

## 5. The ruling required

> **Is CVE→vendor inference permitted to drive the Decision Workspace's
> "affected vendors" and Third-party business impact *before* a human accepts the
> match (authoritative evidence)?**

The governing tension:

- The **two-axis consistency directive** ("automate state changes whenever the
  system has authoritative evidence; reserve explicit user actions for governance
  decisions") argues the matcher's canonical match *is* authoritative evidence and
  should surface.
- The **canonical model** treats `signal_vendor_links` (human-accepted) as the
  affected-vendor contract, and **accepting a suggestion is itself a governance /
  triage decision** — which the same directive says to reserve for humans.
- **IQP** (intelligence quality) mandates honest, non-fabricated customer-facing
  intelligence; **EAR** ("federate, do not subsume", EAR-AD-1) treats vendors as
  first-class assets referenced, not inferred over.

These pull in different directions, hence a ruling rather than an autonomous fix.

## 6. Options

### Option A — "Honest empty state + pending link" (recommended, ALIGNS)
Keep affected-vendors = accepted links (canonical **unchanged**). Third-party
impact derivation **unchanged**. But make the empty state truthful and actionable:
the resolver also reports the **pending** `signal_match_suggestion` count for the
finding's signals, and the Decision Workspace renders *"No accepted vendor links
yet — 1 suggested match pending → Review Links"* instead of a bare "None".
- **Pros:** no canonical change; no impact-math change; converts a misleading
  "None" into an honest, actionable prompt; accepting stays a human governance act
  (consistent with reserve-for-humans); reuses data that already exists.
- **Cons:** Third-party impact still reads None until a human accepts — the number
  a leader sees is conservative until triage.
- **Classification:** ALIGNS with canonical model, IQP, EAR, and the reserve-half
  of the two-axis directive. Additive, no schema.

### Option B — "Automate on matcher evidence" (EXTENDS/redefines)
Treat the canonical match as authoritative: surface the matched vendor as
"affected (suggested)" **and** derive Third-party impact from it pre-acceptance
(resolver runs `canonicalizeVendorName` at read time, or reads the pending
suggestion's target).
- **Pros:** the Microsoft vendor shows immediately; impact reflects it; matches the
  automate-half of the two-axis directive.
- **Cons:** redefines the affected-vendors contract (accepted-links → links +
  inferred matches) and the impact-derivation model; blurs "suggested" vs
  "accepted"; a **false-positive** match now inflates a leader-facing impact number
  before any human validated it.
- **Classification:** EXTENDS/CONTRADICTS the canonical model; needs the
  CANONICAL_DOMAIN_MODEL "third-party impact derivation" section amended.

### Option C — Defer
Ship nothing here; revisit after the two-axis Finding lifecycle is ratified (the
lifecycle spec formalizes "authoritative evidence" vs "governance decision", which
is exactly this question at the vendor grain).

## 7. False-positive / false-negative risk

- **Current (accepted-links only):** zero false positives in impact (a human
  vetted every link); **false negatives** are systematic — every un-triaged
  matcher finding shows "None". This is the observed defect.
- **Option A:** unchanged FP/FN in the *impact number*; removes the *perception* of
  a false negative by disclosing the pending match. Safe.
- **Option B:** introduces impact **false positives** — the matcher's
  normalize-then-exact match is high-precision but not perfect (feed
  `affected_vendor` text is noisy; homonym vendors; a vendor an org lists but the
  CVE targets a different product line). Any FP now moves a leader-facing risk
  number with no human in the loop.
- **The `intelligence.ts:603-614` wrong-join** is a separate, real **false
  negative** on the insights surface. Fixing it faithfully requires replicating
  `canonicalizeVendorName` (legal-suffix stripping) **in SQL**; a naive
  `ILIKE '%..%'` reintroduces the substring leak the canonical function
  deliberately prevents ("hp" matching "shp"). Recommend fixing it in a **separate,
  carefully-scoped PR** (e.g. compute the canonical form application-side and match
  on an exact canonical key), independent of this Decision-Workspace ruling.

## 8. Alignment summary

| Architecture | Option A | Option B |
|---|---|---|
| Canonical domain model (affected = accepted links) | ALIGNS | CONTRADICTS (needs amendment) |
| Two-axis directive — automate on evidence | partial (surfaces evidence, doesn't auto-decide) | ALIGNS |
| Two-axis directive — reserve governance for humans | ALIGNS (accept stays human) | CONTRADICTS (infers pre-accept) |
| IQP (no fabricated customer intelligence) | ALIGNS | RISK (FP impact pre-validation) |
| EAR (federate vendors, don't subsume/infer) | ALIGNS | TENSION |

## 9. Recommendation

**Option A**, plus a *separate* PR for the `intelligence.ts` wrong-join (§7). Option
A removes the misleading "None" without redefining any canonical contract or
putting an unvalidated number in front of leadership, and it keeps vendor
acceptance a human governance act — consistent with both halves of the two-axis
directive. If the business wants pre-acceptance impact (Option B), that should be a
ratified amendment to the canonical third-party-impact model, not an autonomous
change.

## 10. Requested decision

Please rule: **A**, **B**, **C**, or a variant — and, if A, confirm the pending
suggestion may be surfaced read-only on the Decision Workspace (no impact-math
change). Implementation will follow only after the ruling.
