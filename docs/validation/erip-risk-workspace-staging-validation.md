# ERIP Enterprise Risk Workspace — Staging Validation (Packages 1 & 2)

Status: **VALIDATION REPORT — no code changed, no PR.** Subject: PR #559 (squash
`33a62031`, merged to `develop`) — the Finding-centric / Asset-context IA + navigation
restructure + "Review Suggested Links" reskin, dark behind
`SECURELOGIC_RISK_WORKSPACE_ENABLED` (default off).

## Method & honest limitation

This validation is a **code-path validation of the flag-ON behavior** plus a defect
audit, grounded in the merged code. It is **not** a live click-through: there is no
staging URL / credentials / browser available to this session, and the flag is off
everywhere (GATE B). A live operator walkthrough on staging with the flag enabled
remains a required step (see §10 Launch blockers → operator actions). Every verdict
below is traceable to code; where behavior depends on data or a second flag, that is
stated.

Bottom line up front: **Packages 1 & 2 do what they claimed — the IA is cleaner, the
navigation follows the enterprise workflow, and the queue no longer speaks matcher.
They do NOT, by design, deliver the decision-context (business impact, evidence,
ownership, intelligence drill-through) that Scenarios 1/3/4 test — that is Package 3.**
The validation's main value is confirming *which* Package-3/4 work is load-bearing.

---

## 1. Enterprise workflow validation report (Scenarios 1–4)

### Scenario 1 — a new critical Intelligence Event arrives
| Checkpoint | Result | Evidence / why |
|---|---|---|
| Intelligence Event created | ⚠️ Data yes / UI no | `intelligence_events` row is created only when the *separate* `SECURELOGIC_INTELLIGENCE_EVENTS_ENABLED` flag is on; there is **no customer page** that shows the Event as an object (the `/intelligence` view is Package 3, not built). |
| Finding created | ✅ | Ingestion/matcher writes `findings` (`source_type` `cyber_signal`/`intelligence_event`). |
| Finding prioritized correctly | ✅ | Engine orders by priority→severity→created (`findings.ts`); Findings list groups by domain with severity tiles. |
| Business impact shown | ❌ | No business-impact field exists on findings anywhere (Package 3 / Epic-3 propagation). |
| Assets / Vendors / AI Systems provide context | ❌ on the finding | Findings render no asset/vendor/AI linkage. Context exists only on *other* surfaces (Context applicability; the vendor `assess` threat-intel card) with no link from the finding. |
| Controls / Obligations shown | ⚠️ elsewhere only | Visible on control/obligation detail pages via `source_type` filter, not on the finding. |
| Recommendation present | ✅ | `recommendation` field rendered. |
| Evidence linked | ❌ | No evidence/citation field on findings; `source_id` never rendered or linked. |
| No duplicated intelligence | ⚠️ | The same signal still appears as a finding (`cyber_signal` dual-write), a suggestion, a brief item, and an applicability decision, with **no cross-linkage** (Package 3/4). |

**Verdict:** the *navigation* to reach findings improved; the *decision chain* the
scenario tests (impact → affected assets → evidence → single intelligence object) is
**not satisfied** — it is exactly Package 3.

### Scenario 2 — Review Suggested Links (uncertain match)
| Requirement | Result | Evidence |
|---|---|---|
| What SecureLogic found | ✅ | Intelligence Event title (`event_title`), or "External intelligence signal" when the IE layer is dark. Never a raw UUID (`reviewLanguage.signalHeadline`). |
| Why it believes the relationship exists | ✅ | Humanized `describeMatchReason` (no `match_reason` codes). |
| Confidence | ✅ | Confidence band (High/Medium/Low) from `match_score`. |
| Affected object | ✅ | `target_name` + type pill, linked to the entity. |
| Business impact | ❌ | Not shown — no business-impact data on suggestions (Package 3). |
| Accept / Dismiss | ✅ | Unchanged accept/dismiss with 5-second local undo. |
| Bulk workflow | ❌ | **No bulk accept/dismiss** — explicitly excluded (`queue-ui-design-decisions.md`). This is a genuine Scenario-2 gap. |
| No matcher terminology / raw IDs / impl details | ✅ mostly | Title, empty states, "why matched" all de-jargoned. **Minor leak:** the confidence tooltip still says "match score N/100". |

**Verdict:** Review Suggested Links **largely passes** the clarity bar (the core ask of
Packages 1+2). Two gaps: **business impact** (Package 3) and **bulk workflow** (deferred —
needs a scope decision), plus a minor tooltip leak.

### Scenario 3 — Executive / CISO 2-minute test
| Question | Answerable in 2 min? | Why / gap |
|---|---|---|
| What changed today? | ⚠️ Partial | Briefs are weekly; Dashboard "Recent Findings" is closest; a true "today" view needs the Executive dashboard (separate `risk_intelligence` flag) or Package 3. |
| What is my highest priority? | ⚠️ Partial | Findings are priority-ordered, but there is no single exec "top priority" unless the Executive dashboard is on. |
| Which business assets are affected? | ❌ | Findings carry no asset linkage; only the operator Context surface has the trace. |
| What requires executive attention? | ⚠️ Improved | Approvals is now surfaced in Risk Operations (good), but attention items are still spread across Approvals / Findings / Briefs. |
| What decisions must I make? | ⚠️ Partial | No consolidated decision list. |

**Verdict:** the IA (Executive + Risk Operations grouping) helps, but the CISO journey
depends on the Executive dashboard (a different dark flag) and on Package-3 finding
linkage. **Not fully satisfied by Packages 1+2 alone.**

### Scenario 4 — Risk analyst investigates a Finding without page-hopping
| Ability | Result | Why |
|---|---|---|
| Investigate a Finding | ✅ | Detail shows severity/status/priority/likelihood/recommendation + inline actions. |
| Understand the evidence | ❌ | No evidence on the finding and no link to it. |
| Navigate naturally | ⚠️ Improved | Risk Operations now co-locates Findings/Actions/Risks/Approvals (proximity ↑), but finding→source intelligence has **nowhere to go** (no link). |
| Understand ownership | ❌ | `owner_user_id` exists in data; **not displayed**, no assignee UI. |
| Understand recommended action | ✅ | Rendered. |
| …without jumping pages | ❌ for evidence/ownership/intelligence | These are absent or elsewhere-with-no-link. |

**Verdict:** grouping/proximity improved; the "investigate without jumping" bar **fails**
on evidence, ownership, and intelligence — the Finding-detail redesign (Package 3).

---

## 2. Navigation validation (Scenario 5, flag ON)

Confirmed correct by code (`navigation.ts` WORKSPACE_NAV_ITEMS + tests):
- Enterprise-workflow order: Home · Executive · Intelligence[Briefs, Review Links] ·
  Risk Operations[Findings, Actions, Risk Register, Approvals] · Assets[Asset Registry,
  Vendors, AI Systems, Vendor Assurance] · Compliance · Context · Audit Log.
- Approvals + Vendor Assurance surfaced (were nav-orphans). Ask demoted to user menu.
- Flag-off = legacy nav byte-for-byte (test-proven). EAR asset-registry behavior intact.

Residual issues (all Package 3/4 — recommend, do not fix here):
- **Redundant:** `/posture` still exists alongside Dashboard + Executive; `/vendors` vs
  `/vendors/risk` duplicate; Controls ≈ Obligations twins; `/enterprise-context/dashboard`
  is a fourth posture rollup.
- **Dead-end:** the **Actions** page rows still link nowhere — now grouped under Risk
  Operations but still a weak destination.
- **Orphan pages:** `/posture` and `/enterprise-context/dashboard` are not in the
  workspace nav (reachable only via deep links).
- **Possible confusion:** three separate Risk-Operations items (Findings / Actions / Risk
  Register) where Actions is arguably a sub-view of Findings (Package 3 merge).
- **Unlikely-to-visit:** Actions (dead-end), `/posture`.

---

## 3. Finding Detail audit

Does the detail answer the question without leaving the page?

| Question | Answered? |
|---|---|
| What happened? | ✅ (title + description) |
| Why do I care? | ⚠️ severity/priority only; no business framing |
| What changed? | ❌ no change/delta |
| Business impact? | ❌ |
| Affected assets? | ❌ |
| Affected vendors? | ❌ (source label only) |
| Affected AI systems? | ❌ |
| Affected controls? | ❌ |
| Affected obligations? | ❌ |
| Evidence? | ❌ |
| Sources? | ❌ (static `source_type` label, no link) |
| Recommended action? | ✅ |
| Owner? | ❌ (`owner_user_id` in data, not shown) |
| Status? | ✅ |
| Timeline? | ❌ (audit events exist; not surfaced) |

**Verdict:** the Finding detail answers ~4 of 15. **This is the single highest-leverage
Package-3 target** — it is the object the whole workspace is meant to orbit (per the
primary-object thesis) and it is currently the thinnest surface relative to its role.

---

## 4. Review Suggested Links audit

See Scenario 2. **Passes** the de-jargon / clarity / affected-object / confidence /
accept-dismiss bar. **Gaps:** business impact (Package 3), bulk workflow (deferred),
minor "match score N/100" tooltip leak. **Recommendation:** keep as-is for Packages 1+2;
add business impact + bulk to the Package-3/4 scope; drop the raw score from the tooltip
(tiny copy fix, fold into Package 3).

---

## 5. Executive workflow assessment

See Scenario 3. The workspace IA is necessary but not sufficient. The CISO 2-minute test
is met only when (a) the Executive dashboard is enabled (`risk_intelligence`) **and** (b)
Package 3 puts business impact + affected assets on findings. **Recommendation:** treat
"CISO 2-minute readout" as a Package-3 acceptance scenario, not a Packages-1+2 claim.

## 6. Risk analyst workflow assessment

See Scenario 4. Proximity improved; evidence/ownership/intelligence linkage missing.
**Recommendation:** Package 3 finding-detail redesign is the unblocker; sequence it first.

---

## 7. Remaining UX defects (this PR / current state)

1. **Actions page dead-end** — rows link nowhere (pre-existing; now more visible under
   Risk Operations). *(Package 3 merge fixes it.)*
2. **Confidence tooltip leaks the raw score** ("match score N/100") on Review Links.
   *(1-line copy fix; fold into Package 3.)*
3. **Approvals nav not gated on the risk-lifecycle flag** — surfaced for all platform
   users; the page degrades gracefully ("not enabled") but shows a possibly-inert item.
   *(Minor; gate the nav item on the lifecycle flag in a follow-up.)*
4. **`/posture` + `/enterprise-context/dashboard`** remain orphan rollups. *(Package 3
   consolidation.)*

## 8. Remaining architectural inconsistencies

1. **`/ai-systems` entitlement gap** (audit L11) — list + detail gate on token only, not
   entitlement. **AI Systems is now surfaced under the Assets group**, so this
   authorization gap is more reachable. **Elevate to a launch consideration** (see §10).
2. **Gating source inconsistency** — Findings/Risks/Queue use authoritative `getMe()`;
   Executive/Context/Assets trust the session cookie. *(Normalize in a security slice.)*
3. **Dual intelligence representation** — `findings(source_type='cyber_signal')` dual-write
   + two brief engines + suggestions + applicability, uncross-linked. *(Package 3/4.)*
4. **Structural twins** — Controls/Obligations, Vendors/AI, Vendors/Vendors-Risk. *(Package
   3 component consolidation.)*

## 9. Recommended Packages 3 & 4 scope adjustments

Evidence reorders the priority. Recommended **Package 3** (in order of leverage):
1. **Finding decision-grade detail** — owner/assignee + SLA, status timeline, evidence,
   affected assets/vendors/AI/controls/obligations, and **intelligence drill-through** to
   the originating Event/signal. Unblocks Scenarios 1, 3, 4 and the primary-object thesis.
2. **Business-impact surfacing** on findings *and* Review Links (reuse Epic-3 risk
   propagation). Unblocks Scenarios 1, 2, 3.
3. **Actions → Findings "Remediation"** merge (kills the dead-end).
4. **Rollup consolidation** — `/vendors`+`/vendors/risk`, demote `/posture` +
   `/enterprise-context/dashboard`.

Recommended **Package 4** additions surfaced by validation:
5. **Bulk Review Links workflow** (Scenario 2 gap) — bulk accept/dismiss with the same
   undo model.
6. **Customer Intelligence Events view** (`/intelligence`) — the object Scenario 1 expects
   to see; the connective tissue between Briefs, Review Links, applicability, and findings.
7. **Brief-engine convergence** (retire legacy `NewsletterIssue`).

Cross-cutting (not Package 3/4 features — do as a **security slice**): the `/ai-systems`
entitlement fix + `getMe()` gating normalization.

## 10. Launch blockers

For **staging validation** (enable the flag on staging): **no blockers** — the change is
additive, dark, and flag-off is byte-identical. Proceed.

For **production enablement** of `SECURELOGIC_RISK_WORKSPACE_ENABLED`:
- **Not a technical blocker** (no regression; flag-off safe).
- **Product/credibility risk (soft blocker):** enabling the workspace IA *without* Package 3
  promises decision-context (business impact, evidence, ownership, intelligence links) that
  the Finding detail does not yet deliver. **Recommendation: hold production enablement
  until at least Package 3 finding-detail ships** — or enable knowingly, accepting thin
  findings.
- **Security item to resolve before/with prod enablement:** the **`/ai-systems`
  entitlement gap**, now more reachable via the Assets group. Treat as a **blocker for
  enabling the Assets group in production** until fixed.

**Operator actions (ledgered, not executed):**
1. Set `SECURELOGIC_RISK_WORKSPACE_ENABLED=true` on the **staging** app service.
2. Live click-through of Scenarios 1–5 on staging (this report is the checklist).
3. Decide Package-3 scope from §9 before any production enablement ruling.

---

*No engineering performed. No code modified. No PR created. Stop for review.*
