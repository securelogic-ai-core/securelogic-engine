"use client";

/**
 * RemediationSlaSection.tsx — the org's remediation SLA, made settable.
 *
 * SURFACING, NOT BUILDING. The policy
 * (risk_settings.finding_sla_by_severity, migration 20260903), its validation,
 * its audit trail and the code that applies it have existed for months. The
 * only thing missing was a way for a customer to see or change it, so the
 * "SLA Breached" queue was decorative for every organization we had not
 * configured by hand. This section is that field and nothing more — there is
 * no second SLA mechanism here.
 *
 * THREE THINGS THIS UI MUST NOT MISREPRESENT, because the engine is specific:
 *
 *   1. CALENDAR DAYS. The engine computes CURRENT_DATE + days. There is no
 *      business-day, working-day or holiday arithmetic anywhere in the
 *      platform. Saying "days" and letting an administrator assume working
 *      days would silently make every deadline ~40% longer than they think.
 *
 *   2. PROSPECTIVE ONLY. The SLA is applied when a finding is CREATED and
 *      never recomputed. Changing it does not move a single existing due date
 *      — by design, since a policy change that silently rewrote historical
 *      deadlines would corrupt the overdue record an auditor relies on.
 *
 *   3. "NOT CONFIGURED" IS A STATE. A null policy means findings get no
 *      automatic deadline at all. That is a real operating condition and is
 *      shown as one, not as an empty form.
 */

import { useState, useTransition } from "react";
import { putRiskSettings } from "@/lib/api";

const SEVERITIES = ["Critical", "High", "Moderate", "Low"] as const;
type Severity = typeof SEVERITIES[number];

/** Mirrors riskSettingsValidation.ts — the server rejects anything outside it. */
const MIN_DAYS = 1;
const MAX_DAYS = 3650;

/** A common starting point, not a platform default: the engine has none. */
const SUGGESTED: Record<Severity, number> = {
  Critical: 7, High: 14, Moderate: 30, Low: 90,
};

const SEVERITY_COLORS: Record<Severity, string> = {
  Critical: "#fca5a5", High: "#fdba74", Moderate: "#fcd34d", Low: "#86efac",
};

interface Props {
  initialSla: Record<string, number> | null;
  cadenceByRating: Record<string, number>;
  canEdit: boolean;
}

export function RemediationSlaSection({ initialSla, cadenceByRating, canEdit }: Props) {
  const [configured, setConfigured] = useState(initialSla !== null);
  const [values, setValues] = useState<Record<Severity, string>>(() => ({
    Critical: String(initialSla?.["Critical"] ?? SUGGESTED.Critical),
    High:     String(initialSla?.["High"]     ?? SUGGESTED.High),
    Moderate: String(initialSla?.["Moderate"] ?? SUGGESTED.Moderate),
    Low:      String(initialSla?.["Low"]      ?? SUGGESTED.Low),
  }));
  const [dirty, setDirty] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; msg: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function flash(type: "success" | "error", msg: string) {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 4000);
  }

  /** Same bounds as the server, checked here so the customer sees them inline. */
  function invalidReason(): string | null {
    for (const sev of SEVERITIES) {
      const n = Number(values[sev]);
      if (!Number.isInteger(n) || n < MIN_DAYS || n > MAX_DAYS) {
        return `${sev} must be a whole number of days between ${MIN_DAYS} and ${MAX_DAYS}.`;
      }
    }
    return null;
  }

  function save(next: Record<string, number> | null) {
    startTransition(async () => {
      // cadence_by_rating is required by the endpoint, so the cadence currently
      // on screen travels with every save — changing the SLA must never blank
      // the review cadence.
      const res = await putRiskSettings(cadenceByRating, { finding_sla_by_severity: next });
      if (res.ok) {
        setConfigured(next !== null);
        setDirty(false);
        flash("success", next === null
          ? "Remediation SLA turned off. New findings will have no automatic due date."
          : "Remediation SLA saved. It applies to findings created from now on.");
      } else {
        flash("error", res.error === "forbidden" || res.error === "http_403"
          ? "Only organization admins can change the remediation SLA."
          : "Could not save. Please try again.");
      }
    });
  }

  const problem = invalidReason();

  return (
    <section
      style={{
        background: "#0f172a", border: "1px solid #1e293b",
        borderRadius: "12px", padding: "24px", marginTop: "16px",
      }}
    >
      <h2 style={{ margin: 0, fontSize: "15px", fontWeight: 700, color: "#f1f5f9" }}>
        Remediation SLA
      </h2>
      <p style={{ margin: "6px 0 4px", fontSize: "13px", color: "#94a3b8", lineHeight: 1.6 }}>
        How long your organization allows to remediate a finding, by severity. When set, a
        new finding is given a due date of <strong>today plus these calendar days</strong>,
        and appears in the <strong>SLA Breached</strong> queue once that date passes.
      </p>
      <p style={{ margin: "0 0 16px", fontSize: "12px", color: "#64748b", lineHeight: 1.6 }}>
        Calendar days, not working days — weekends and holidays are included. A due date
        set by hand on an individual finding always wins over this policy. Changes apply to
        findings created from now on; existing due dates are never rewritten.
      </p>

      {!configured && (
        <div
          style={{
            background: "#1e1b16", border: "1px solid #78350f", borderRadius: "8px",
            padding: "12px 14px", marginBottom: "16px",
          }}
        >
          <p style={{ margin: 0, fontSize: "13px", color: "#fcd34d", fontWeight: 600 }}>
            No remediation SLA is configured
          </p>
          <p style={{ margin: "4px 0 0", fontSize: "12px", color: "#a8a29e", lineHeight: 1.6 }}>
            New findings are created with no due date unless someone sets one by hand, so
            nothing can be overdue and the SLA Breached queue stays empty.
          </p>
        </div>
      )}

      <div style={{ display: "grid", gap: "10px" }}>
        {SEVERITIES.map((sev) => (
          <div
            key={sev}
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              gap: "16px", padding: "10px 12px",
              border: "1px solid #1e293b", borderRadius: "8px",
            }}
          >
            <span style={{ fontSize: "13px", fontWeight: 600, color: SEVERITY_COLORS[sev] }}>
              {sev}
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <input
                type="number"
                aria-label={`${sev} remediation days`}
                min={MIN_DAYS}
                max={MAX_DAYS}
                value={values[sev]}
                disabled={!canEdit || pending}
                onChange={(e) => { setValues({ ...values, [sev]: e.target.value }); setDirty(true); }}
                style={{
                  width: "88px", padding: "6px 8px", textAlign: "right",
                  background: "#020617", border: "1px solid #334155",
                  borderRadius: "6px", color: "#e2e8f0", fontSize: "13px",
                }}
              />
              <span style={{ fontSize: "12px", color: "#64748b" }}>calendar days</span>
            </span>
          </div>
        ))}
      </div>

      {problem && dirty && (
        <p style={{ margin: "12px 0 0", fontSize: "12px", color: "#fca5a5" }}>{problem}</p>
      )}

      {canEdit ? (
        <div style={{ display: "flex", gap: "10px", alignItems: "center", marginTop: "16px" }}>
          <button
            type="button"
            disabled={pending || Boolean(problem) || (!dirty && configured)}
            onClick={() =>
              save(Object.fromEntries(SEVERITIES.map((s) => [s, Number(values[s])])))
            }
            style={{
              background: "#0d9488", color: "#fff", border: "none", borderRadius: "8px",
              padding: "8px 18px", fontSize: "13px", fontWeight: 600,
              cursor: pending || problem ? "not-allowed" : "pointer",
              opacity: pending || problem || (!dirty && configured) ? 0.6 : 1,
            }}
          >
            {configured ? "Save SLA" : "Turn on remediation SLA"}
          </button>
          {configured && (
            <button
              type="button"
              disabled={pending}
              onClick={() => save(null)}
              style={{
                background: "transparent", color: "#94a3b8", border: "1px solid #334155",
                borderRadius: "8px", padding: "8px 14px", fontSize: "13px", cursor: "pointer",
              }}
            >
              Turn off
            </button>
          )}
        </div>
      ) : (
        <p style={{ margin: "16px 0 0", fontSize: "12px", color: "#64748b" }}>
          Only organization admins can change the remediation SLA.
        </p>
      )}

      {toast && (
        <p
          role="status"
          style={{
            margin: "12px 0 0", fontSize: "13px",
            color: toast.type === "success" ? "#5eead4" : "#fca5a5",
          }}
        >
          {toast.msg}
        </p>
      )}
    </section>
  );
}
