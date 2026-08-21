# Tabletop — suspected cross-tenant data exposure

**Run on paper 2026-08-21 against `develop@fdcc2a10`.**
**Not a validation.** This walks the documented process to find the places it
breaks. What it found is in §Findings — and some of it cannot be executed today.

## Scenario

> Tuesday, 14:20 local. A customer emails support:
>
> *"I'm looking at our vendor list and there's a company on it we've never worked
> with — 'Northwind Logistics'. I've attached a screenshot. Is this a bug?"*

The customer is an existing paying organization. The named company is not theirs.

---

## Walkthrough

### T+0 — L1 intake (`SR-009`)

L1 recognises this as suspected cross-tenant exposure and follows `SR-009`:

- **Does not** ask for the data, or open the screenshot into another system
- **Does not** attempt to reproduce it
- Asks the customer to keep it and not share it further
- Records: time (with timezone), reporting organization **slug**, the surface (the
  vendor list), what they were doing
- Escalates to the Security Owner immediately, without confirming first
- Sends the approved holding line — no cause, no scope, no reassurance

**Boundary held.** Everything L1 did is intake and collection. ✅

**⚠️ Friction found:** the screenshot is already in the support mailbox. `SR-009`
says do not ask for the data — it does **not** say what to do when the customer
attaches it unprompted, which is what actually happens.

### T+5m — Security Owner acknowledges (§5)

Acknowledges to support and to the customer. Nothing is declared yet.

### T+10m — Triage (§6)

Question: is this plausibly a security event? A vendor record from an unknown
company on a customer's list is either cross-tenant data, or the customer's own
record they don't recognise, or seeded/demo data.

**Cannot be answered without looking** — and looking is investigation, not triage.
Security Owner **declares SEV1** on the principle that suspected cross-tenant
exposure is SEV1 before confirmation.

- Incident Owner: Security Owner (named)
- Engineering notified in parallel

**⚠️ Friction found:** §6 says triage decides "is this plausibly security", but the
cheapest disambiguation — *is Northwind a real org in the platform?* — is already
an investigative query. In practice triage and investigation blur at T+10. The
process should say so rather than pretend they are sequential.

### T+15m — Evidence preservation (§7)

| Required | Available? |
|---|---|
| Audit events | ✅ `security_audit_log`, WORM-protected |
| Auth/security events | ⚠️ engine logs — **retention unverified** |
| Timestamps | ✅ from the customer + logs |
| Request/correlation ID | ❌ **the customer has no request ID to quote** (SUP-OBS-5) |
| Affected tenants | ⚠️ reporting org known; the *other* org unknown until investigated |
| Configuration state | ✅ `render.yaml` + deployed env |
| Deploy version | ✅ `GET /api/version`; Render deploy record |
| Communications | ✅ the original email |

**🔴 Blocker found:** without a correlation ID, correlating the customer's view to a
log line depends on a timestamp search across a window — and **if this were
reported days later, the logs may be gone.** Retention is unverified.

### T+30m — Investigation (§9)

Engineering must establish whether isolation was actually bypassed.

- Is "Northwind Logistics" an organization in the platform? *(DB query, Engineering)*
- Did the reporting org's request return rows from another org? *(logs + code path)*
- Was RLS bypassed, or did the app query on an elevated channel without a tenant
  scope? *(code review + `test/isolation/` assertions)*

**⚠️ Friction found:** there is **no alert** that would have caught this — detection
was a customer noticing (SUP-OBS-4). Had they not looked at the list, nobody would
know.

**Realistic alternative outcome worth stating:** the most likely finding is that
this is **not** cross-tenant at all — it is a seeded demo vendor, or a vendor the
customer's own colleague added. The process correctly treats it as SEV1 anyway, and
correctly does not tell the customer "it's probably nothing" while that is unknown.

### T+45m — Containment decision (§8)

If isolation *was* bypassed on the vendor list path:

- **Disable the affected feature via flag** — Security Owner authorises, Engineering
  executes. Fastest reversible containment. ✅ executable today
- **Not** an ad-hoc database write. ✅ boundary held

**⚠️ Friction found:** not every surface has a flag. The vendor list is core; there
may be **no flag to turn off**, leaving "scale the service to 0" (a full outage) as
the only containment lever. §8 does not acknowledge that gap.

### T+1h — Impact assessment

Which tenants, which records, how long, was it read by anyone.

**🔴 Blocker found:** there is **no way to determine who else saw it.** Reads are not
audited at row level — `security_audit_log` records actions, not every read. So
"was this exposed to other customers too?" is answerable only by reasoning about
the code path, not from evidence.

### T+1h30 — Communications (§11) and legal (§12)

Security Owner owns the message. Affected tenants get an update at declaration and
hourly. The **second** affected org — Northwind — is *not* contacted yet: §12 first.

**🔴 Blocker found:** **there is no named legal/privacy reviewer.** §12 cannot be
executed. The decision on whether this is notifiable, to whom, and by when has
nobody to make it — during a live SEV1.

### T+several hours — Recovery (§10)

Fix, deploy, verify with `DR_PLAN.md` §5. Corrective actions become Findings.
✅ executable.

### Closure and PIR (§13, §14)

Security Owner declares contained, then resolved once root cause is understood and
corrective actions are raised as Findings with owners. PIR within 5 working days.
✅ executable — but see the single-point-of-failure gap.

---

## Findings

| # | Finding | Severity | Executable today? |
|---|---|---|---|
| **TT-1** | **No named legal/privacy reviewer** — §12 cannot be executed during a live SEV1 | **Critical** | ❌ |
| **TT-2** | **Cannot determine who else saw exposed data** — reads are not audited at row level | **High** | ❌ |
| **TT-3** | **No correlation ID for the customer to quote** — correlation relies on timestamp search | High | ⚠️ partial |
| **TT-4** | **Log retention unverified** — evidence may expire before investigation | High | ❌ unknown |
| **TT-5** | **No cross-tenant detection** — found only because a customer looked | High | ❌ |
| **TT-6** | **Not every surface has a containment flag** — core surfaces may only be containable by taking the service down | Medium | ⚠️ |
| **TT-7** | **`SR-009` does not cover unsolicited attachments** — the most likely real-world intake | Medium | ✅ fixable in doc |
| **TT-8** | **Triage/investigation blur** — the cheapest disambiguation is already investigative | Low | ✅ fixable in doc |
| **TT-9** | **Single person is Security Owner, Incident Owner and operator** | Medium | ⚠️ accepted |

## What this tabletop does NOT establish

- That anyone can execute this under real pressure — **no live exercise has been
  run**
- That log retention is sufficient — **unverified**
- That containment works — **no containment has been rehearsed**
- That the process holds when the Security Owner is unavailable

**The process is coherent. It is not proven.** TT-1, TT-2 and TT-4 are gaps that
documentation cannot close.
