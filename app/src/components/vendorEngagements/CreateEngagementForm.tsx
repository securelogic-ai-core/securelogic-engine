"use client";

/**
 * CreateEngagementForm — the full-intake create form for a vendor engagement.
 *
 * No defaults on the twelve scored questions: the engine refuses a partial
 * intake, and this form does not submit until every question is answered. On
 * a 400, the engine names exactly which fields were missing or invalid; that
 * text is surfaced verbatim.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createEngagement } from "@/app/actions/vendorEngagements";
import { INTAKE_FIELDS, ENGAGEMENT_TYPES } from "@/lib/vendorEngagementIntake";
import type { VendorEngagementIntakeInput } from "@/lib/api";

type Props = {
  vendors: Array<{ id: string; name: string }>;
};

const UNANSWERED = "";

export default function CreateEngagementForm({ vendors }: Props): JSX.Element {
  const router = useRouter();
  const [vendorId, setVendorId] = useState(UNANSWERED);
  const [engagementType, setEngagementType] = useState<
    "initial" | "periodic" | "targeted" | "event_driven"
  >("initial");
  const [title, setTitle] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [breachNotification, setBreachNotification] = useState<"" | "yes" | "no">("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const unanswered = INTAKE_FIELDS.filter((f) => !answers[f.name]).map((f) => f.label);
  if (breachNotification === "") unanswered.push("Regulatory breach notification");
  const ready = vendorId !== UNANSWERED && unanswered.length === 0;

  const submit = () => {
    setError(null);
    if (!ready) {
      setError(`Answer every intake question first. Unanswered: ${unanswered.join(", ")}`);
      return;
    }
    const intake = {
      ...answers,
      regulatory_breach_notification: breachNotification === "yes",
    } as unknown as VendorEngagementIntakeInput;
    startTransition(async () => {
      const r = await createEngagement({
        vendor_id: vendorId,
        engagement_type: engagementType,
        ...(title.trim() ? { title: title.trim() } : {}),
        intake,
      });
      if (r.ok) {
        router.push(`/vendor-engagements/${r.id}`);
      } else {
        setError(r.error);
      }
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <section style={card()}>
        <h2 style={h2()}>Engagement</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <label style={labelStyle()}>
            Vendor
            <select
              value={vendorId}
              onChange={(e) => setVendorId(e.target.value)}
              disabled={pending}
              style={inputStyle()}
            >
              <option value={UNANSWERED}>Select a vendor…</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <label style={labelStyle()}>
            Engagement type
            <select
              value={engagementType}
              onChange={(e) => setEngagementType(e.target.value as typeof engagementType)}
              disabled={pending}
              style={inputStyle()}
            >
              {ENGAGEMENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label style={{ ...labelStyle(), gridColumn: "1 / -1" }}>
            Title (optional — defaults to “{"<vendor>"} assurance review”)
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={300}
              disabled={pending}
              style={inputStyle()}
              placeholder="e.g. Acme Corp annual assurance review"
            />
          </label>
        </div>
      </section>

      <section style={card()}>
        <h2 style={h2()}>Inherent risk intake</h2>
        <p style={{ color: "#9ca3af", fontSize: 13, marginTop: 0 }}>
          All questions are required. The computed rating travels with its full basis, so a
          reviewer never has to re-derive how it was reached.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {INTAKE_FIELDS.map((f) => (
            <label key={f.name} style={labelStyle()} title={f.help}>
              {f.label}
              <select
                value={answers[f.name] ?? UNANSWERED}
                onChange={(e) => setAnswers((a) => ({ ...a, [f.name]: e.target.value }))}
                disabled={pending}
                style={inputStyle(answers[f.name] === undefined)}
              >
                <option value={UNANSWERED}>Select…</option>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <span style={{ color: "#6b7280", fontSize: 11 }}>{f.help}</span>
            </label>
          ))}
          <label style={labelStyle()}>
            Regulatory breach notification
            <select
              value={breachNotification}
              onChange={(e) => setBreachNotification(e.target.value as "" | "yes" | "no")}
              disabled={pending}
              style={inputStyle(breachNotification === "")}
            >
              <option value="">Select…</option>
              <option value="yes">Yes — a vendor incident triggers notification duties</option>
              <option value="no">No</option>
            </select>
            <span style={{ color: "#6b7280", fontSize: 11 }}>
              Whether a breach at this vendor triggers your own regulatory notification
              obligations. “No” is a legitimate answer — but it must be given, not assumed.
            </span>
          </label>
        </div>
      </section>

      {error && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: 6,
            background: "rgba(127,29,29,0.2)",
            border: "1px solid #b91c1c",
            color: "#fca5a5",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
        <button
          type="button"
          onClick={submit}
          disabled={pending || !ready}
          title={ready ? undefined : `Unanswered: ${unanswered.join(", ")}`}
          style={{
            padding: "9px 18px",
            borderRadius: 6,
            border: "none",
            background: pending || !ready ? "#1f2937" : "#2563eb",
            color: pending || !ready ? "#6b7280" : "#fff",
            cursor: pending || !ready ? "not-allowed" : "pointer",
            fontSize: 14,
          }}
        >
          {pending ? "Computing inherent risk…" : "Open engagement"}
        </button>
      </div>
    </div>
  );
}

function card(): React.CSSProperties {
  return {
    padding: 20,
    borderRadius: 8,
    border: "1px solid #1f2937",
    background: "rgba(15,23,42,0.5)",
  };
}

function h2(): React.CSSProperties {
  return { fontSize: 16, fontWeight: 600, margin: "0 0 12px" };
}

function labelStyle(): React.CSSProperties {
  return {
    display: "flex",
    flexDirection: "column",
    gap: 5,
    fontSize: 13,
    color: "#d1d5db",
  };
}

function inputStyle(unanswered = false): React.CSSProperties {
  return {
    padding: "8px 10px",
    borderRadius: 6,
    border: `1px solid ${unanswered ? "#a16207" : "#374151"}`,
    background: "#020617",
    color: "#e5e7eb",
    fontSize: 13,
  };
}
