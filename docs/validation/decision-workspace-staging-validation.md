# Decision Workspace — Staging Validation Checklist (ERIP Package 3, phases 3.0–3.2b)

Scope: the **Decision Workspace only** (`/findings/:id` with the flag on). P3.3
(drill-through, Remediation tab, `/actions`→My Actions) is now SHIPPED dark — see
**§P3.3** at the end of this doc for its validation steps. P3.4 (list redesign) not yet.
No code changes — this is an operator checklist. Success criteria at the end.

Subject: `develop` @ `44e963bc` (PRs #560/#561/#562/#563). Behind
`SECURELOGIC_DECISION_WORKSPACE_ENABLED` (default off), two-switch (engine **and** app).

---

## 0. Preconditions & setup (do first)

- [ ] **P0.1 Enable the flag on staging, BOTH services** (two-switch): set
  `SECURELOGIC_DECISION_WORKSPACE_ENABLED=true` on the staging **engine** and staging
  **app** services; restart both. (Migration `20260829` runs additively on engine boot.)
- [ ] **P0.2 Confirm flag-OFF baseline first** (before enabling, or on a second org): open a
  finding — it renders the **legacy** detail unchanged. This is the byte-identical control.
- [ ] **P0.3 Seed a realistic SIGNAL-SOURCED finding** (this is the finding type that
  exercises every zone): a `cyber_signal`/`intelligence_event`-sourced finding with
  (a) an accepted signal→vendor link (affected vendor), (b) 1–2 evidence rows
  (`source_type='finding'`), (c) a linked Intelligence Event (title/severity/CVE/sources),
  and ideally an affected control + obligation. Use the demo/seed org, not real client data.
- [ ] **P0.4 Seed What's-Changed inputs:** open the finding, click **Mark reviewed**; then
  make a change (e.g. PATCH severity or status) so an audit event is recorded; then reopen.
- [ ] **P0.5 Note the known-deferred behaviours** (§ "Known deferred") so expected-empty
  zones are not logged as defects.
- [ ] **P0.6 Seed an ASSESSMENT-SOURCED finding (the negative / empty-state control):** a
  finding whose `source_type` is `vendor_review` (ideal — it *names* a vendor yet resolves no
  affected vendor, which is the sharpest test) or `control_test` / `ai_review` /
  `obligation_review`. Give it a real title, severity, and a `recommendation`. Do **not**
  attach signal links or an intelligence event. This finding is used in **§6** to confirm that
  every empty zone is an **Expected Empty**, not a defect — and to check whether the UI *says
  so*. Keep it in the same seed org as the intelligence-sourced finding (P0.3) so the two can
  be compared side by side.

---

## 1. Executive workflow — the 2-minute CISO test

Open the seeded finding. Start a timer. Without scrolling into the collapsible analyst
zones, answer:

- [ ] **E1.** In **≤2 minutes**, can you state what needs attention and the decision to make?
- [ ] **E2. Executive Decision Summary (Zone A):** title + severity + **business-impact
  headline** + risk score + owner + SLA are visible **without scrolling**; the one-line
  intent is clear.
- [ ] **E3. Business Impact (Zone C) is immediately understandable:** the five dimensions
  (Revenue / Operational / Regulatory / Customer / Third-party) each show a level chip; the
  *sourced* ones (third-party / regulatory / operational) reflect the affected entities.
- [ ] **E4. Recommended decision is obvious:** the **Decision** control (Needs Review /
  Accepted Risk / In Progress / Mitigating / Resolved) and the **Accept Risk** / **Escalate**
  buttons are clearly the actions a leader takes; distinct from the operational **Status**.
- [ ] **E5.** You did **not** need to open another page to reach an executive decision.

---

## 2. Analyst workflow — investigate without page-hopping

- [ ] **A1. Affected Context (Zone D):** vendors / AI systems / business processes / controls
  / obligations are grouped with counts; each links out to the entity (open in a new tab —
  confirm the link resolves, then return).
- [ ] **A2. Evidence & Intelligence (Zone E):** the supporting **Intelligence Event**
  (title/severity/CVE), its **sources**, and the finding's **evidence** are all present
  inline; confidence is shown.
- [ ] **A3. Activity (Zone G):** the activity log lists recent changes to the finding
  (create/status/severity/assignment). **Note the naming gap:** this is the finding
  **Activity** log (`security_audit_log`), not an intelligence **Timeline**. The engine
  resolves an `intelligence_event_timeline` but the UI does **not render it** today — if you
  expected a chronological intel timeline (CVE published → exploited → patched), record its
  absence as a P2 gap, not a bug.
- [ ] **A4. Recommendation & remediation (Zone F):** the recommendation text is shown and you
  can add/track a remediation action **on the same page**.
- [ ] **A5. Related findings (Zone G):** shown (or an honest "None").
- [ ] **A6.** Across A1–A5 you investigated the finding **without leaving** `/findings/:id`
  except to open a linked entity for editing.

---

## 3. Decision quality — the 8-question matrix

For the seeded finding, confirm the page answers each **on one screen**. (Column 3 =
where it lives.)

- [ ] **Q1 What happened?** → Zone A title + description.
- [ ] **Q2 Why do I care?** → Zone A executive summary + Zone C business impact.
- [ ] **Q3 What changed?** → Zone B "What's changed" (requires P0.4; else honest "No
  changes" / "First review").
- [ ] **Q4 What evidence supports this?** → Zone E evidence + sources.
- [ ] **Q5 What vendors / AI / controls / obligations are affected?** → Zone D.
  **Assets are NOT surfaced here** — Zone D groups vendors / AI systems / controls /
  obligations only; there is no asset linkage in the workspace (the Asset Registry lives
  behind a separate flag and is not joined in). If the finding should name affected assets,
  record it as a coverage gap (expected; asset linkage is out of P3 scope).
- [ ] **Q6 What should I do next?** → Zone A actions + Zone F recommendation/remediation.
- [ ] **Q7 Who owns this?** → Zone A owner (email or "Unassigned").
- [ ] **Q8 What is the business impact?** → Zone C (with Revenue/Customer honestly
  "Not assessed").

Log any question that requires navigating elsewhere or is unanswerable.

---

## 4. Navigation

- [ ] **N1.** From the Findings list, opening a finding lands on the Decision Workspace
  (flag on) — the flow feels finding-centric and natural. **Note:** the Findings list card
  shows only severity + status; it surfaces **no decision_state, risk score, or "workspace"
  cue**, so there is no signal from the list that a decision experience awaits. Judge whether
  the list still reads as an alert feed that happens to open a richer page.
- [ ] **N2.** Deep links out (vendor/control/obligation/AI) work and return cleanly.
- [ ] **N3. Dead ends:** none within the workspace — every zone either has content or an
  honest empty state; no control leads nowhere.
- [ ] **N4. Duplicate workflows:** remediation shown here (Zone F) is the same object as the
  standalone `/actions` page — note the duplication (expected; `/actions` consolidation is
  P3.3, not in scope).
- [ ] **N5.** Back-to-Findings and browser-back behave as expected.

---

## 5. UX review — decision-support, not an alert viewer

- [ ] **U1. Language is enterprise-grade:** no raw pipeline vocabulary, no `match_reason`
  codes, no raw signal UUIDs anywhere in the workspace.
- [ ] **U2. Business decision vs operational status** reads as two distinct, intentional
  concepts — not redundant.
- [ ] **U3. Risk score is credible:** the number + band (Zone A chip `Risk <n>/100 (<band>)`)
  align with severity/priority/confidence. **The rationale is computed but NOT shown** — there
  is no hover, tooltip, or breakdown in the UI. Judge credibility from the number alone, and
  record "risk rationale not surfaced" as a P2 explainability gap (a decision-support tool
  should show *why* the score is what it is).
- [ ] **U4. Honest gaps read as honest:** "Not assessed" (revenue/customer) and empty zones
  feel deliberate, not broken.
- [ ] **U5. Friction:** count clicks to reach a decision; note any unnecessary step, missing
  context, or slow round-trip on a decision/status change (each currently refreshes the page).
- [ ] **U5b. `Escalate` semantics:** the `Escalate` button sits in the decision controls but
  changes **priority → immediate**, not `decision_state` (and not `status`). Confirm this is
  unsurprising to an operator; if pressing "Escalate" next to the Decision dropdown reads as
  "set a decision," flag it as a P2 UX ambiguity.
- [ ] **U6. Alert-viewer smell test:** does the page make you *decide* (impact → owner →
  action) rather than merely *read* an alert? Flag anything that still feels like a feed row.
- [ ] **U7. Progressive disclosure:** executive zones (A/B/C/F) are always visible; analyst
  zones (D/E) collapse/expand correctly and default sensibly.

---

## 6. Empty-state validation by finding source (the negative-control scenario)

The Decision Workspace draws **every** zone from one payload
(`GET /api/findings/:id/context`). What populates depends on the finding's `source_type`.
This section makes the expected behaviour explicit **per source**, so future QA can tell a
correct empty state from a regression. Validate the intelligence finding (P0.3) and the
assessment finding (P0.6) **side by side**.

### 6.0 The core distinction — Expected Empty vs Unexpected Empty

- **Expected Empty** = the finding's source genuinely cannot supply that information, so the
  zone is empty *by design*. Example: an assessment-sourced finding has no intelligence event,
  so **Evidence & Intelligence → "No linked intelligence event"** is correct.
- **Unexpected Empty** = the data *should* exist for this source but is absent — a failed
  correlation, a broken join, a resolver bug, or missing seed data. Example: an
  intelligence-sourced finding **with** an accepted signal→vendor link that still shows
  **Affected context (0)** is a defect.

**The validation question is not only "is it empty?" but "does the UI let the operator know
*which kind* of empty it is?"** A decision-support system must not present an Expected Empty
in a way that looks broken.

### 6.1 Expected behaviour by zone × source

Exact rendered strings are from `DecisionWorkspace.tsx`. "Intel" = source_type
`cyber_signal`/`signal`/`intelligence_event`. "Assessment" = `vendor_review`/`control_test`/
`ai_review`/`obligation_review`/`dependency_review` (and `manual`/`risk`).

| Zone | Intel-sourced (expected) | Assessment-sourced (expected) | How to spot an **Unexpected Empty** |
|---|---|---|---|
| **A — Decision header** | Fully populated (title, severity, decision chip, risk chip, owner/SLA/confidence). | **Identical — always populated.** Zone A never legitimately empties. | Missing title/severity, `Risk 0/100`, or a blank decision selector = defect (Zone A is source-independent). |
| **A — "Business impact: X" chip** | Reflects top sourced dimension (High/Medium/Low). | ⚠️ Falls back to **"Business impact: Low"** even when Zone C shows every dimension None/Not assessed (`?? "low"`). | This mismatch (header "Low" vs body all-empty) is a **known inconsistency to record** (P2) — not a pass, not a crash. |
| **B — What's changed** | "No changes…" / "First review…" until P0.4 seeded. | Same. Source-independent. | A change was made after Mark reviewed but nothing lists = defect. |
| **C — Business impact** | Third-party / Regulatory / Operational show levels + counts (`"N affected vendor(s)"`). Revenue/Customer = **"Not assessed"**. | **Third-party/Regulatory/Operational = "None"** with notes `"No affected vendors"` / `"No affected obligations"` / `"No affected controls or AI systems"`. Revenue/Customer = **"Not assessed"**. **All five are Expected Empty.** | Intel finding with accepted links but dimension still "None" = failed correlation (Unexpected). |
| **D — Affected context** | Open, `Affected context (N>0)`; vendor/AI/control/obligation links resolve. | **Collapsed, `Affected context (0)`; each group "None".** Expected Empty. ⚠️ **But the UI gives no reason** — see 6.2. | Intel finding with a seeded link showing `(0)` = defect. Assessment finding showing entities it never linked = defect. |
| **E — Evidence & Intelligence** | Open; event title/severity/CVE inline; "Sources:" line; Evidence (N). | **Collapsed; "No linked intelligence event" + "No evidence attached".** Expected Empty. | Intel finding whose seeded event/evidence does not appear = defect. |
| **E — Intelligence drill-through** | ⚠️ **Not available for either source** — the event is display-only inline; there is **no clickable drill-through page** (P3.3). | Not available (correctly — none to link). | Record "no intel drill-through" once as a known P3.3 gap; do not log per-finding. |
| **F — Recommendation & action** | `recommendation` free-text + remediation actions. | Same field, **source-agnostic** — it "reflects the assessment workflow" **only if the assessment author wrote it**; the UI does not switch templates by source. | Empty recommendation on a finding that has one stored = defect. Blank because nobody authored it = data gap, not a UI defect. |
| **G — Related findings** | "None" or a list. | Same. | — |
| **G — Activity** | Lists finding audit events. | Same (populates as you edit). | Actions taken but no audit rows = defect. |

### 6.2 The decisive empty-state check (most important item in this section)

- [ ] **X1. Assessment finding — Affected Context communicates *by design*, not *error*.** Open
  the P0.6 finding. Zone D shows **`Affected context (0)`** and, expanded, **"None"** under
  every group; Zone C shows **"No affected vendors"** etc. These are all correct
  (Expected Empty). **Now judge as an operator who does not know the internals:** does the
  screen make clear this is *unavailable by design for an assessment finding*, or does it look
  like a **failed correlation / broken page**? Current UI shows **bare `(0)` / "None"** with
  **no explanatory text** tying it to finding source. **Record the verdict:** if it reads as
  broken, that is a **P1 decision-support gap** (an alert viewer shows blanks; a decision tool
  explains them). This is the single most valuable observation this checklist can capture.
- [ ] **X2. Same-payload sanity:** side by side, the intelligence finding populates D/E and the
  assessment finding does not — confirming the difference tracks **source**, not a transient
  failure. If the *intelligence* finding is also empty, that is an **Unexpected Empty**
  (setup/correlation problem — recheck P0.3 seed links before blaming the UI).
- [ ] **X3. No fabricated data on the assessment finding:** Revenue/Customer say "Not assessed"
  (never a made-up level); risk score is still a real number from severity/priority/confidence,
  not zero. Fabrication or a silent `0/100` here is a defect.
- [ ] **X4. Header/body consistency:** note whether Zone A's "Business impact: Low" chip
  contradicts Zone C's all-None/Not-assessed body on the assessment finding (see 6.1). Log per
  6.1 as P2.

### 6.3 Per-source expected-behaviour checklist (itemised — run for each finding)

Run block **A** against the intelligence finding (P0.3) and block **B** against the assessment
finding (P0.6). Each item states the **expected behaviour** and the classification
(**Expected Populated** / **Expected Empty** = working as designed / **Unexpected Empty** =
defect trigger). ⚠ marks the three places where a requested *target* behaviour is **not yet in
the current build** — those are documented gaps to record once, **not** per-finding defects.

**A. Intelligence-sourced finding — every zone should populate.**

- [ ] **I1. Executive Decision Summary (Zone A)** — **Expected Populated:** title, severity,
  decision chip, `Risk n/100 (band)`, owner, SLA, confidence all present. Missing title/severity,
  `Risk 0/100`, or a blank decision selector = **Unexpected** (defect; Zone A is source-independent).
- [ ] **I2. Business Impact (Zone C)** — **Expected Populated:** Third-party / Regulatory /
  Operational carry a real level chip + count note. Revenue / Customer = **"Not assessed"**
  (Expected Empty, by design — never fabricated). A sourced dimension showing **"None"** despite
  an accepted link = **Unexpected** (failed correlation).
- [ ] **I3. Affected Context (Zone D)** — **Expected Populated:** open, `Affected context (N>0)`,
  vendor/AI/control/obligation links resolve. `Affected context (0)` with a seeded accepted link =
  **Unexpected** (defect).
- [ ] **I4. Evidence & Intelligence (Zone E)** — **Expected Populated:** event title/severity/CVE
  inline, `Sources:` line, `Evidence (N>0)`. A seeded event/evidence that does not appear =
  **Unexpected** (defect).
- [ ] **I5. Intelligence drill-through** — ⚠ **Requested target: a clickable path from the inline
  event to its detail. Current build: NOT present** — the event is display-only inline (plain
  text, no link); no drill-through page exists (**P3.3**, see Known deferred). Record **once** as
  the known P3.3 gap; inline-only is **not** a defect and must **not** be logged per finding.

**B. Assessment-sourced finding — the negative control; empties are by design.**

- [ ] **S1. Executive Decision Summary (Zone A)** — **Expected Populated, identical to I1**
  (source-independent). Zone A is **never** legitimately empty — do not classify it Expected Empty.
  Same defect triggers as I1.
- [ ] **S2. Business Impact (Zone C)** — **Expected Empty (all five):** Revenue / Customer =
  **"Not assessed"**; Third-party / Regulatory / Operational = **"None"** with notes
  **"No affected vendors" / "No affected obligations" / "No affected controls or AI systems"**.
  (Note the sourced dims read **"None"**, not "Not assessed" — the explanatory *note* is what
  signals "by design".) ⚠ Zone A's **"Business impact: Low"** chip still shows **Low** (`?? "low"`
  fallback) even though the body is all None/Not-assessed — header/body inconsistency, **record P2**
  (6.1 / X4); not a pass, not a crash.
- [ ] **S3. Affected Context (Zone D)** — **Expected Empty:** `Affected context (0)`, every group
  **"None"**. Assessment sources resolve no signal-linked entities today (Known deferred). An
  assessment finding surfacing entities it never linked = **Unexpected** (defect).
- [ ] **S4. Explanatory messaging on the empty Affected Context** — ⚠ **Requested target: the UI
  states the empty is unavailable *by design* for an assessment finding. Current build: NOT
  present** — bare `(0)` / "None" with no source-tied text. This is the decisive **X1** observation:
  if it reads as a failed correlation / broken page, log **P1**. Record the verdict; do not silently
  pass.
- [ ] **S5. No Intelligence drill-through** — **Expected Empty, correct** (there is no event to
  link). Not a defect.
- [ ] **S6. Recommendation & action (Zone F)** — ⚠ **Requested target: wording reflects an
  assessment / remediation workflow rather than an intelligence workflow. Current build:
  source-agnostic** — the same free-text `recommendation` + remediation-action block renders
  regardless of source; the UI does **not** switch templates or wording by source. Populated only
  if the assessment author wrote the recommendation. **Blank-because-unauthored = data gap (not a UI
  defect); blank-when a value is stored = Unexpected (defect).** Record "recommendation not
  source-differentiated" as a **P2/P3** enhancement if leadership expects assessment-specific guidance.
- [ ] **S7. Aggregate: every empty communicates *by design*, not *error*.** Across S2–S5, judge as
  an operator who does not know the internals: does the assessment finding read as **deliberately
  unavailable** or **broken**? This is the **PASS-7 / X1 verdict**.

> **Reconciliation — three requested target behaviours are not yet in the build.** They are
> documented here as **gaps, not passes**, so QA records each once instead of re-logging it as a
> defect: **(a)** intelligence drill-through (**I5** — P3.3 deferred), **(b)** explanatory messaging
> on an Expected-Empty Affected Context (**S4** — P1 candidate per X1), **(c)** source-differentiated
> recommendation wording (**S6** — enhancement). QA confirms the **current honest states** above and
> flags these three as known gaps.

---

## Known deferred (do NOT log these as defects)

- **Assessment-sourced findings** (vendor_review / control_test / obligation_review / ai_review)
  currently resolve **no affected entities via signal links** — Zone D will be empty for them.
  Use a **signal/intelligence-event-sourced** finding to validate Affected Context (P0.3).
  (Assessment-source affected resolution is a documented later enhancement.)
- **Revenue / Customer business impact** are intentionally **"Not assessed"** (no data source;
  never fabricated).
- **What's Changed** needs a prior **Mark reviewed** + a subsequent recorded change (P0.4);
  otherwise it correctly shows "First review" / "No changes".
- **No dedicated `/intelligence/[id]` drill-through page** yet — the event is surfaced inline
  in Zone E (P3.3 will add the standalone page).
- **Intelligence Timeline not rendered** — `intelligence_event_timeline` is resolved by the
  engine but no UI panel displays it. Zone G "Activity" is the finding audit log, a different
  thing. (Record as a gap if an intel timeline is expected; not a regression.)
- **Risk rationale not surfaced** — the score's rationale trace is computed but never shown.
- **Assets not linked** into Affected Context (vendors / AI / controls / obligations only).
- **`/actions` standalone page still exists** (not redirected) — P3.3.
- **Assign** is display-only in Zone A (owner shown; interactive re-assign UI is a follow-up);
  ownership is still settable via the existing PATCH path.
- **No DOM render regression tests** in the app (no RTL harness) — validation is manual here.

---

## Success criteria (pass = ready to consider prod enablement or P3.3)

- **PASS-1 Executive:** E1 met (decision in ≤2 min) AND E2–E5 all check.
- **PASS-2 Analyst:** A6 met (no page-hopping) AND A1–A5 all check for the signal-sourced finding.
- **PASS-3 Decision quality:** all 8 questions (Q1–Q8) answered on one screen for the seeded finding.
- **PASS-4 Navigation:** N1–N3, N5 pass; N4 duplication noted (acceptable, tracked to P3.3).
- **PASS-5 UX:** U1, U2, U4, U6, U7 pass; U3 credible; U5 friction list has no P0/P1 items.
- **PASS-6 Safety:** P0.2 confirmed flag-OFF is byte-identical (legacy detail unchanged).
- **PASS-7 Empty-state integrity (§6):** for the assessment-sourced finding, every empty zone
  is classified **Expected** vs **Unexpected** per the 6.1 matrix and the itemised **6.3**
  checklist (block A: I1–I5; block B: S1–S7); X2 confirms the difference tracks source (intel
  finding populates, assessment finding does not); X3 confirms no fabrication and a real risk
  score. The three documented target-vs-build gaps (6.3 I5 / S4 / S6) are **recorded once**, not
  logged as per-finding defects. **X1 is a required *observation*, not a required pass** —
  record whether the empty states read as "by design" or "broken"; a "broken"-reading Affected
  Context is a P1 to fix before P3.3, not an overall-fail of staging.

**Overall PASS** = all seven (PASS-7 = correct classification + X2/X3 hold; X1/X4 recorded). Any failure that is not in "Known deferred" is a workspace defect
to fix before extending (P3.3) or enabling in production. Record findings by
zone + severity (P0 blocker / P1 major / P2 minor / P3 polish).

---

*Checklist only — no code changed. After staging validation, the operator decides: proceed
to P3.3, adjust the Decision Workspace, or authorize Package 4.*

---

## §P3.3 — Intelligence drill-through + Remediation tab + /actions (SHIPPED dark, PRs #565–#569)

Subject: `develop` @ P3.3 merge. All dark. No render.yaml change in this package.

### P3.3.0 Flag preconditions (three-flag reality)
- [ ] **App:** set `SECURELOGIC_RISK_WORKSPACE_ENABLED=true` **and**
  `SECURELOGIC_DECISION_WORKSPACE_ENABLED=true` on the staging **app** service; restart.
- [ ] **Engine:** set `SECURELOGIC_DECISION_WORKSPACE_ENABLED=true` on the staging **engine**
  service; restart. (Baseline — the drill-through renders from finding-context.)
- [ ] **Optional enrichment:** set `SECURELOGIC_INTELLIGENCE_EVENTS_ENABLED=true` (engine) to
  serve the fuller canonical event (executive summary, recommended actions, related findings).
  With it OFF the drill-through must still render (finding-context) or show the honest
  "intelligence detail unavailable" state — never blank/crash.

### P3.3.1 Drill-through page (`/intelligence/[id]`)
- [ ] From a signal-sourced finding's **Evidence & intelligence** (Overview tab), the supporting
  event is a **link** → opens `/intelligence/[id]` with header + sources + timeline.
- [ ] Flag-OFF control: with `DECISION_WORKSPACE` off, `/intelligence/<any-id>` returns **404**.
- [ ] There is **no** `/intelligence` index page and **no** "Intelligence" item in the top nav.

### P3.3.2 Clickable Finding→event + Queue reciprocal
- [ ] Finding Zone E event links carry `?finding=<id>` (back link + fallback work).
- [ ] In **Review Suggested Links** (queue, workspace on), a row with an intelligence event shows
  **View intelligence** → the drill-through. Flag-OFF queue is unchanged (no such link).

### P3.3.3 Remediation tab
- [ ] The finding detail shows **Overview | Remediation** tabs; zones A–C stay above; "Mark
  reviewed" stays visible. Remediation tab hosts the recommendation + add-action form.

### P3.3.4 /actions → My Actions (R5)
- [ ] Flag-ON: visiting `/actions` redirects to `/actions?view=mine`; the header reads
  **My Actions** and lists only actions owned by the signed-in user.
- [ ] Confirm a second user sees only THEIR actions (no cross-user leak).
- [ ] Flag-OFF: `/actions` is the unchanged org-wide "Remediation Actions" list.

*Checklist only — no code changed.*
