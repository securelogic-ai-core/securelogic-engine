# Risk Lifecycle R3 — Staging Walkthrough

Manual operator validation of the R3 lifecycle UI on **staging** (develop). Runs
end-to-end: create → happy path → SoD-blocked self-approval → approve as a second
admin → reject loop-back → history renders every event, plus the flag-off and
viewer checks.

## Preconditions

1. This PR is merged to `develop` and staging (engine + app) has redeployed.
2. On the **staging engine web service and workers**, set
   `SECURELOGIC_RISK_LIFECYCLE_ENABLED=true`, then let them redeploy. (Leave prod
   `false` — main is frozen.)
3. A **premium/platform-entitled** org on staging.
4. Two users in that org:
   - **User A** — proposer. Any non-viewer role (`analyst`/`member` or `admin`).
   - **User B** — approver. Must be **`admin`** and a **different** user than A.
   - (Optional) **User C** — `viewer`, for the read-only check.

> All actions below are done in the app UI unless noted. The lifecycle panel and
> history render only when the flag is on; when off, they don't appear at all.

## 1. Create a risk → Draft

1. As **User A**, go to `/risks/new`, create a risk (title + a rating). Open it at
   `/risks/[id]`.
2. **Expect:** a **Lifecycle** card with state pill **Draft**, the 12-stage rail
   (Identified ✓, Created highlighted), and a single action **Begin assessment**.

## 2. Begin assessment → Assessment (scoping)

1. Click **Begin assessment**, enter a comment, **Confirm**.
2. **Expect:** state → **Assessment**. A **Requirements** strip appears:
   *Risk owner assigned* ✗, *Residual risk scored* ✗, *Evidence attached* (○ if the
   org's evidence gate is advisory).

## 3. Satisfy the scoping gates

1. Use **Edit** to set an **owner** and a **residual rating/score**. Return to the
   risk; the panel auto-refreshes on load.
2. **Expect:** Requirements now show *owner* ✓ and *scored* ✓. The **Advance to
   treatment** action is now available.

## 4. Advance to treatment → add a plan

1. Click **Advance to treatment** (comment, Confirm). **Expect:** state → **Treatment
   Selection**, requirement *Treatment plan added (0)*.
2. Add a treatment via **+ Add Treatment**. Return to the risk.
3. **Expect:** *Treatment plan added (1)*; the **Request approval** button is enabled.

## 5. Request approval → Pending Approval

1. As **User A**, click **Request approval**, enter a rationale, **Submit for
   approval**.
2. **Expect:** state → **Pending Approval**; an amber "Awaiting executive approval"
   banner.

## 6. SoD — the proposer cannot approve their own request

1. Still as **User A**, open `/approvals`.
2. **Expect:** the risk's row shows **"You proposed this — you can't approve your own
   request (separation of duties)"** with **Approve/Reject disabled**.
   - (Engine cross-check, optional: a direct `POST
     /api/risks/:id/approvals/:approvalId/decision` as A returns **409
     `sod_violation`**.)

## 7. Reject as a second admin → loop-back to Treatment Selection

1. Sign in as **User B** (admin). Open `/approvals`.
2. **Expect:** Approve/Reject are **enabled** on the row.
3. Click **Reject**, enter a rationale, **Confirm rejection**.
4. **Expect:** the row disappears; a toast **"Rejected — returned to Treatment
   Selection."** Open the risk → state is **Treatment Selection** again (loop-back).

## 8. Re-request and approve → Mitigation

1. As **User A**, **Request approval** again (new rationale) → **Pending Approval**.
2. As **User B**, open `/approvals`, **Approve** (rationale, **Confirm approval**).
3. **Expect:** toast **"Approved — moved to Mitigation."** Open the risk → state
   **Mitigation**.

## 9. Walk the remainder

1. As **User A** on the risk: **Mark remediation complete** → **Validation**;
   **Validation passed** → **Residual Review**; **Close risk** → **Closed**.
   (Each opens the comment modal.)

## 10. History renders every event

1. On the risk, scroll to **Lifecycle History**.
2. **Expect:** an entry for **every** transition, newest first, each with the
   transition label, `from → to`, actor, comment, and timestamp:
   `begin_assessment`, `advance_to_treatment`, `submit_for_approval`, `reject`,
   `submit_for_approval`, `approve`, `complete_mitigation`, `pass_validation`,
   `close`.

## 11. Viewer is read-only

1. Sign in as **User C** (`viewer`). Open the risk.
2. **Expect:** the Lifecycle card renders the rail and history, but **no action
   buttons** — instead "Read-only access — you can view the lifecycle but not change
   it." `/approvals` shows rows read-only with "only an approver (admin) can decide."
   - (Engine cross-check, optional: any transition/approval POST as C returns **403
     `read_only_access`**.)

## 12. Flag-off = zero lifecycle affordances

1. Set `SECURELOGIC_RISK_LIFECYCLE_ENABLED=false` on the staging engine (or use an
   org where it's off) and redeploy.
2. Open a risk detail page.
3. **Expect:** **no** Lifecycle card and **no** Lifecycle History card — the risk
   page looks exactly as it did before R1–R3. `/approvals` shows "The risk approval
   workflow isn't enabled for your organization yet." Everything else (register,
   treatments, controls, obligations, cadence, RR-3 history) is unchanged.

---

**Pass criteria:** every "Expect" holds; the SoD block (step 6), the reject loop-back
(step 7), the approve→mitigation (step 8), the full history (step 10), the viewer
read-only (step 11), and the flag-off invariant (step 12) all behave as described.
