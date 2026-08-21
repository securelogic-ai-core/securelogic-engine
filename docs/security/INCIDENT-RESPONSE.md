# Incident Response — minimum process

**Status:** ACTIVE from 2026-08-21. Proportional to a soft launch and a small team.
**Owner:** Platform operator (also the Security Owner — see §4).
**Scope:** security incidents affecting SecureLogic or its customers' data.

> **What this is.** The defined process behind "escalate to the named human", so
> the SEV1 support runbooks no longer stop there.
>
> **What this is not.** Not a SOC, not an on-call rotation, not an IR tool, and not
> a compliance binder. Every step below is executable by one or two people. If a
> step cannot be performed with today's tooling, it says so.

**Reuses, does not replace:**
- severity model → `docs/runbooks/support/SUPPORT-AUTHORITY-MODEL.md`
- support authority boundaries → same document
- availability/recovery incidents → `docs/DR_PLAN.md` (§7 incident commander,
  §5 recovery validation)
- detection and intake from customers → the `SR-*` security runbooks
- corrective actions → the platform's own Findings/Risk lifecycle (§10)

---

## 1. What counts as a security incident

A **security event** is anything that *might* affect confidentiality, integrity or
authorised access. A **security incident** is an event that a Security Owner has
declared, after triage.

**Not every event becomes an incident.** Declaring is a deliberate act, because it
starts a clock and a record.

Always treat as a candidate incident:

- suspected **cross-tenant exposure** (any amount — one record is not small)
- suspected account compromise or credential exposure
- suspected unauthorised access to customer data
- authorisation bypass, or tenant-isolation failure
- a credible externally-reported vulnerability
- unexplained modification or deletion of customer data or audit records

**Availability alone is not a security incident.** A platform outage is `SR-008`
and `DR_PLAN.md` — unless there is reason to think it is caused by or concurrent
with an attack, in which case run both.

## 2. Severity — the existing model, applied

Use the **same SEV1–SEV4 scale** support already uses. No second scale.

| | Security meaning | Declare? |
|---|---|---|
| **SEV1** | Suspected or confirmed exposure of customer data, cross-tenant access, compromise, or authorisation bypass | **Yes, immediately** |
| **SEV2** | Security-relevant defect with no evidence of exposure; credential exposed but no known use | Yes |
| **SEV3** | Weakness with no exploit path demonstrated; hardening gap | Optional — usually a Finding, not an incident |
| **SEV4** | Informational; no exposure | No — record as a Finding |

**Suspected cross-tenant exposure is SEV1 on report, before confirmation.** The
cost of an hour spent on a false alarm is an hour. The cost of treating a real one
as routine is the company.

## 3. Detection and intake

Incidents arrive four ways:

| Route | Entry point |
|---|---|
| **Customer reports to support** | `SR-009`, `SR-010`, `SR-013` — L1 collects and escalates |
| **External researcher / third party** | `SECURITY.md` → security contact, or via support → `SR-014` |
| **Internal observation** | Anyone who notices it escalates directly. No triage gate first. |
| **Automated alert** | Operator alert channel, Sentry, or a failing security check |

**Anyone may escalate. Nobody needs permission to raise a suspicion.** A culture
where people check first is a culture that finds out late.

## 4. Roles — the minimum, and no more

| Role | Who, at soft launch | Responsibility |
|---|---|---|
| **Security Owner** | Platform operator | Receives escalations, declares incidents, owns severity, authorises containment, approves communications |
| **Incident Owner** | Named per incident (usually the Security Owner) | Drives it to closure, keeps the record, calls in help |
| **Engineering** | Whoever holds the relevant knowledge | Investigation, containment execution, recovery |
| **Legal/Privacy reviewer** | **NAMED PERSON REQUIRED — see §8** | Determines notification obligations |
| **Support (L1/L2)** | Support | Intake, evidence collection, customer holding lines |

**Every declared incident has exactly one Incident Owner, named at declaration.**
When the Security Owner is unavailable, the incident does not wait: the person who
escalated becomes Incident Owner until relieved, with authority to preserve
evidence and to request containment.

This mirrors `DR_PLAN.md` §7 (single incident commander) deliberately — one
concept, two contexts.

## 5. Escalation path — what happens after the named human

This section is the reason this document exists.

```
Escalation received by Security Owner
  └─ ACKNOWLEDGE within the hour (to the reporter and to support)
     └─ TRIAGE (§6) — is this a security event at all?
        ├─ Not security → hand to the right runbook, record why, done
        └─ Security → DECLARE
           ├─ assign Incident Owner (named)
           ├─ set severity (§2)
           ├─ start the incident record (§7)
           └─ SEV1 only: notify Engineering immediately, in parallel
              └─ INVESTIGATE (§9) ── CONTAIN (§8) ── ASSESS IMPACT
                 └─ COMMUNICATIONS decision (§11)
                    └─ LEGAL/PRIVACY review if impact is possible (§12)
                       └─ RECOVER (§10)
                          └─ CLOSE (§13) ─ PIR for material incidents (§14)
```

**Containment and investigation run in parallel with impact assessment.** Do not
serialise them: stopping an ongoing exposure never waits for the analysis of what
it exposed.

**If the Security Owner does not acknowledge within 4 hours for a SEV1**, the
escalator notifies them by a second channel and, failing that, proceeds to preserve
evidence and request containment from Engineering directly. **Silence is not a
hold.**

## 6. Triage — assess without destroying or over-claiming

Triage answers one question: **is this plausibly a security event?** It does not
determine breach status, and it must not.

Do, in this order:

1. **Preserve first, investigate second** (§7). Triage that destroys evidence has
   made the incident worse.
2. Establish **what was observed** — not what is assumed. Distinguish "a customer
   saw another company's name" from "customer data was exposed"; they are often the
   same event and sometimes not.
3. Establish **whether it is ongoing**. An active exposure changes everything about
   sequencing.
4. Set a **provisional** severity. Severity may rise; it should rarely fall
   silently — record the reason when it does.

**Do not, during triage:**
- state or imply that a breach occurred
- tell a customer it was "a display issue" before anyone knows
- attempt to reproduce a suspected tenant-isolation failure — **reproducing it
  creates a second exposure** (see `SR-009`)
- close it because it "looks like nothing"

## 7. Evidence preservation — minimum requirements

Do this **before** investigating, and before any containment that changes state.

**Capture:**

| Evidence | Where it lives | Note |
|---|---|---|
| Audit events | `security_audit_log` | **WORM-protected** — DB triggers block row mutation and truncate, so this survives even an attacker with app-role access |
| Auth/security events | Engine logs | **Time-limited — see §L gaps.** Export or screenshot promptly |
| Timestamps | Everything, **with timezone** | The single most common omission |
| Request / correlation IDs | Engine logs (`requestId`) | The only reliable way to correlate a customer report to a log line |
| Affected tenant(s) | Organization **slug**, not name | See confidentiality below |
| Configuration state | `render.yaml` + deployed env at the time | Flag values change behaviour |
| Deployment / version | Deployed commit SHA per service | `GET /api/version` on the app; Render deploy record for the engine |
| Communications | The original report, unedited | Including any proof-of-concept |

**Tenant confidentiality during an incident:**

- Reference organizations by **slug or id**, never by customer name, in shared
  channels or tickets.
- **Do not copy exposed content into the incident record.** Describe it — "a vendor
  record belonging to another organization was visible" — and reference where it can
  be retrieved. Copying it spreads the exposure into more systems, including ones
  with different retention.
- Never paste credentials, tokens or session cookies into the record. If one is
  already there, it is exposed → `SR-013`.

**Do not delete anything** — including the offending record, export or message.
Removing it destroys the evidence and does not undo the disclosure.

## 8. Containment — who may authorise what

**The Security Owner authorises containment.** Engineering executes.

| Action | Authority | Note |
|---|---|---|
| Disable a feature flag | Security Owner + Engineering | Fastest reversible containment for a code-path exposure |
| Revoke an API key | Security Owner | Breaks live integrations — coordinate unless exposure is active |
| Rotate a secret | Security Owner + Engineering | `DR_PLAN.md` §4d. **`FIELD_ENCRYPTION_KEY` / `MFA_SECRET_KEY` require a migration plan — do not rotate ad hoc** |
| Invalidate sessions | Security Owner + Engineering | `JWT_SECRET` rotation invalidates all sessions platform-wide |
| Take a service offline | Security Owner | `DR_PLAN.md` §7 (scale web service to 0) |
| Suspend a user/org | Security Owner | Customer-visible — pair with communications |

**Nobody may contain by editing production database state.** This is the standing
principle from `SUPPORT-AUTHORITY-MODEL.md` and it does not relax during an
incident — an ad-hoc write during a live incident is invisible to every system that
believed the old value, and it destroys the evidence of what the attacker did. If a
data change is genuinely required, it is an Engineering change with the Incident
Owner recording the reason **before** it is made.

**Containment is reversible where possible.** Prefer a flag off over a deletion,
and a revocation over a rewrite.

## 9. Investigation

Engineering + Security establish, and record in the incident record:

- **What happened** — the mechanism, not the symptom
- **When it started and stopped** — with timezone
- **Which tenants are affected** — by slug/id
- **What data was affected** — categories, not contents
- **The exposure path**, where determinable
- **Whether tenant isolation was affected** — asked and answered explicitly, even
  when the answer is "no"
- **Whether it is ongoing**

**Record "unknown" where it is unknown.** An investigation that reads as complete
because the gaps were smoothed over is worse than one that names them — the
notification decision in §12 depends on knowing which facts are established.

**Tenant isolation is a specific question with a specific answer.** RLS is enforced
in Postgres with `USING` + `WITH CHECK` on `app.current_org_id`, and the
`test/isolation/` suites assert it per table. If isolation was bypassed, say how.

## 10. Eradication and recovery

**No generic technical recovery procedure is written here, deliberately.**

- Where a **validated** runbook exists, reference it. Today: `DR_PLAN.md` §4–§5 for
  restore and post-restore validation; §4d for secret rotation.
- **Every other recovery is Engineering/Security-owned and UNVALIDATED** —
  consistent with **SUP-PROC-1**. Manufacturing steps here to make the document look
  complete would put an untested procedure in front of someone during an incident.

After any recovery touching data or services, run the `DR_PLAN.md` §5 validation
checklist — it already exists and already includes "audit log shows pre-incident
events (WORM survived)".

**Corrective actions do not live here.** They become **Findings** in SecureLogic
and follow the platform's own lifecycle (§14).

## 11. Customer communications

**The Security Owner owns and approves every security-incident communication.**

| Who | May |
|---|---|
| **L1/L2 support** | Use the approved holding lines in `SR-009`/`SR-010`/`SR-013`. Nothing else. |
| **Security Owner** | Approve all substantive communication |
| **Anyone else** | Nothing, without approval |

**L1 must never characterise an event as a breach, or state impact.** Not because
support is untrusted, but because impact is a determination that requires facts
nobody has yet — and a reassurance given early cannot be withdrawn.

**Principles:**
- Tell affected customers something true and early rather than complete and late.
- Never speculate about cause, scope or blame.
- Never say "no data was affected" until the investigation supports it.
- Do not contact a *second* affected tenant before §12 — notification is a legal
  decision, not a courtesy call.
- Cadence for a declared SEV1, per `DR_PLAN.md` §7: at declaration, then hourly to
  affected tenants while it is ongoing.

## 12. Legal / privacy / regulatory escalation

**Trigger: obtain legal/privacy review whenever exposure of customer or personal
data is *possible* — not once it is confirmed.** Waiting for certainty consumes the
window in which a decision has to be made.

**This document deliberately states no notification deadline.** Obligations depend
on jurisdiction, the data involved, and the customer contract, and inventing a
universal "72 hours" here would be wrong as often as right.

**Determination required, by a named reviewer:**

- whether a notifiable event occurred, under which regime(s)
- which customers, regulators or authorities must be told, and by when
- what may be said, and by whom
- record-keeping obligations

**GAP: no legal/privacy reviewer is currently named, and no notification
determination has been made for any regime.** This is the largest open item in this
process — see §16. The existing `docs/legal/` determinations cover data-subject
export and erasure, **not breach notification.**

## 13. Closure

**Only the Security Owner may declare an incident contained or resolved.**

| State | Requires |
|---|---|
| **Contained** | Exposure demonstrably stopped; containment recorded; evidence preserved |
| **Resolved** | Root cause understood; corrective actions raised as Findings with owners; communications complete; legal/privacy determination made or explicitly recorded as not required |

**"We stopped seeing it" is not containment.** Absence of further reports is not
evidence — the same discipline the platform applies to vulnerability absence
(`SR-026`) applies to incidents.

## 14. Post-incident review

**Required for every SEV1, and any incident with customer impact.** One page,
within 5 working days. Blameless.

Cover: **timeline** (with timezone) · **root cause** · **impact** (tenants, data
categories, duration) · **containment** (what worked, what did not) · **recovery** ·
**control failures** — including detection: how long until anyone knew? ·
**corrective actions** with owners and due dates · **lessons learned**.

**Corrective actions become SecureLogic Findings**, in the platform, with severity,
SLA, owner, evidence and closure — the same lifecycle we ask customers to use, and
the same audit trail. **Do not create a separate remediation tracker.** Where a
corrective action reveals a systemic exposure, promote it to the Risk Register.

**File PIRs in `docs/security/incidents/` as `PIR-YYYY-MM-DD-<slug>.md`.** No
customer names, no exposed content.

## 15. Exercising this process

A tabletop for the highest-risk scenario is in
`docs/security/TABLETOP-cross-tenant-exposure.md`.

**A tabletop is not validation.** It proves the process is coherent on paper. It
does not prove the tooling exists or that anyone can execute it under pressure. The
gaps it exposed are recorded in §16 and in `SUPPORT-READINESS-GAPS.md`.

## 16. Known gaps in this process

Stated plainly, because a process that hides its own weaknesses is worse than none.

| Gap | Impact | Owner |
|---|---|---|
| **No named legal/privacy reviewer** | §12 cannot be executed. Notification determination has nobody to make it. **Largest gap.** | Unowned |
| **No breach-notification determination for any regime** | Obligations unknown in advance; the clock would start during the incident | Unowned |
| **Single point of failure** | Security Owner, Incident Owner and Platform operator are one person. §5's second-channel rule mitigates but does not solve it | Accepted for soft launch |
| **No cross-tenant detection** | Exposure is found by a customer noticing (**SUP-OBS-4**) | Post-launch |
| **Log retention is time-limited and unverified** | Evidence may expire before an investigation starts. Retention tier is **OPERATOR-VERIFY** | Unowned |
| **No login history / active sessions** | Compromise scope cannot be reconstructed (**SUP-OBS-16**) | Post-launch |
| **No per-API-key usage history** | Blast radius after credential exposure is unassessable (**SUP-OBS-17**) | Post-launch |
| **Recovery is UNVALIDATED** | Except DR_PLAN §4–§5. Consistent with SUP-PROC-1 | Post-launch |
| **No IR exercise has been run with real people** | The tabletop is on paper only | Before or at launch |

## 17. Review

Review after any SEV1, after any material architecture change, and at least
quarterly. Owner: Platform operator.
