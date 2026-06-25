# Example: brief item + memos (decision-grade, grounded)

Each example is grounded in real objects and passes the five decision-quality questions.
Contrast shows the banned generic style vs. the required specific style.

## 1. Intelligence Brief item (VERIFIED shape)

❌ **Generic (rejected):**
> A new vulnerability has been disclosed that may affect posture. Organizations should review
> their exposure and consider patching.

✅ **Decision-grade:**
```
Title:        Critical RCE in Fortinet FortiOS (CVE-2026-XXXXX) — exploited in the wild
Severity:     Critical
Category:     vulnerability
Affected CVE: CVE-2026-XXXXX
Affected vendor: Fortinet (matched to your vendor inventory: "Fortinet" — criticality: high)
Why it matters: CVSS 9.8, public PoC, active exploitation. You list Fortinet as a high-
  criticality perimeter vendor; this is internet-facing exposure on a control you depend on.
Analysis: Unauthenticated RCE via the SSL-VPN pre-auth path; KEV-listed (severity pinned).
Recommended actions: Security lead to apply FortiOS 7.x patch on all perimeter appliances
  within 48h; confirm no exposed mgmt interface; open a finding against the Fortinet vendor
  record. (immediate)
```
Grounded in: a `cyber_signals` row + a `signal_vendor_links` match to the org's `vendors`
row; the recommendation maps to an `actions` item (owner, due, priority).

## 2. Risk memo (RECOMMENDED template, over a `risks` row)
```
DECISION: Accept or mitigate Risk R-142 (concentration on a single cloud provider).
RISK:     Likelihood: likely · Impact: High · Rating: High.
EXPOSURE: 9 of 12 critical vendors depend on <Provider>; a regional outage degrades
          intake, brief delivery, and evidence storage simultaneously.
TREATMENT: Type: mitigate · Owner: Platform lead · Status: in_progress
          (multi-region failover for the two highest-criticality dependencies).
RECOMMENDATION: Mitigate; do not accept. Target residual: Moderate by <date>.
EVIDENCE: risk_treatments R-142-T1; findings F-880, F-881; evidence E-203 (dependency map).
```
Every value pulled from `risks` / `risk_treatments` / `findings` / `evidence`. Canonical
enums used.

## 3. Approval / decision memo (RECOMMENDED template)
```
DECISION REQUESTED: Approve production enablement of <feature> behind <flag>.
CONTEXT: Staging soak passed (5/5 exercises); zero prod changes to date.
OPTIONS:
  A. Enable now — fastest value; relies on staging parity. 
  B. Extend soak 1 week — lower risk; delays launch.
RECOMMENDATION: B, then A — one more redeploy-kill cycle in staging before the flag flip.
APPROVER: <name> · DATE: <date>
AUDIT REF: security_audit_log event "<feature>.enablement_approved".
```
The decision lives on the workflow + audit log; the memo narrates it. No invented status.

## 4. Remediation plan (RECOMMENDED template, over findings + actions)
```
Open findings: 14 (Critical 2, High 5, Moderate 7). Overdue actions: 3.
P1 — F-901 (Critical, Vendor Risk): unpatched Fortinet RCE.
     Action A-901: patch perimeter appliances · Owner: J. Lee · Due: 2026-07-02 · immediate.
P2 — F-877 (High, AI Governance): model card missing bias eval.
     Action A-877: complete eval + sign-off · Owner: R. Patel · Due: 2026-07-10 · near_term.
...
```
Counts come from the data (an `actions/summary`-style query), never estimated.

## 5. The integrity guardrails in action
- Posture line when there are no findings: **"Overall posture: insufficient data (no open
  findings this period)."** — never "0 / low risk".
- Don't write "SOC 2 certified" or "ISO 27001 compliant" — the repo supports SOC 2 *gap
  analysis* and an `iso_42001` crosswalk; certification claims are unproven.
- One org per document. If you can't source a number from that org's objects, omit it or mark
  it unavailable.
