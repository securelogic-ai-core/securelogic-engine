"use client";

import { useState } from "react";
import Link from "next/link";
import { updateAiSystemAction, deleteAiSystemAction, type AiSystemEditData } from "./actions";
import type { AiSystem } from "@/lib/api";

const inputStyle: React.CSSProperties = {
  background: "#0a0f1a",
  borderColor: "#1e2d45",
  color: "#f1f5f9",
};

const cardStyle: React.CSSProperties = {
  background: "var(--brand-surface, #0d1626)",
  border: "1px solid #1e2d45",
  borderRadius: "12px",
};

const DATA_CLASSIFICATION_OPTIONS = [
  { value: "",             label: "— Not set —" },
  { value: "public",       label: "Public" },
  { value: "internal",     label: "Internal" },
  { value: "confidential", label: "Confidential" },
  { value: "restricted",   label: "Restricted" },
];

const DEPLOYMENT_STATUS_OPTIONS = [
  { value: "",            label: "— Not set —" },
  { value: "development", label: "Development" },
  { value: "testing",     label: "Testing" },
  { value: "production",  label: "Production" },
  { value: "deprecated",  label: "Deprecated" },
];

const CRITICALITY_OPTIONS = [
  { value: "",         label: "— Not set —" },
  { value: "critical", label: "Critical" },
  { value: "high",     label: "High" },
  { value: "medium",   label: "Medium" },
  { value: "low",      label: "Low" },
];

const RISK_CLASSIFICATION_OPTIONS = [
  { value: "",        label: "— Not set —" },
  { value: "high",    label: "High" },
  { value: "medium",  label: "Medium" },
  { value: "low",     label: "Low" },
  { value: "minimal", label: "Minimal" },
];

// ── Governance vocabularies (T2-C) — hardcoded to EXACTLY the engine's closed
// lists in aiSystemValidation.ts (which the migration CHECKs mirror). The
// engine validates authoritatively; these only shape the pickers.

const EU_AI_ACT_TIER_OPTIONS = [
  { value: "",               label: "— Not classified —" },
  { value: "prohibited",     label: "Prohibited" },
  { value: "high_risk",      label: "High risk" },
  { value: "limited_risk",   label: "Limited risk" },
  { value: "minimal_risk",   label: "Minimal risk" },
  { value: "not_applicable", label: "Not applicable" },
];

const HUMAN_OVERSIGHT_OPTIONS = [
  { value: "",                         label: "— Not declared —" },
  { value: "none",                     label: "None" },
  { value: "human_in_the_loop",        label: "Human in the loop" },
  { value: "human_on_the_loop",        label: "Human on the loop" },
  { value: "autonomous_consequential", label: "Autonomous (consequential)" },
];

const SENSITIVE_DATA_OPTIONS = [
  { value: "pii",          label: "PII" },
  { value: "phi",          label: "PHI" },
  { value: "payment_card", label: "Payment card" },
  { value: "credentials",  label: "Credentials" },
  { value: "biometric",    label: "Biometric" },
  { value: "financial",    label: "Financial" },
  { value: "proprietary",  label: "Proprietary" },
];

type DeleteResult = { error: string; details?: { reviews?: number } };

export function EditAiSystemForm({
  aiSystem,
  members = [],
}: {
  aiSystem: AiSystem;
  /** Active org members for the business-owner picker (empty = picker still renders, unassigned-only). */
  members?: Array<{ id: string; label: string }>;
}) {
  const [name, setName]                         = useState(aiSystem.name);
  const [useCase, setUseCase]                   = useState(aiSystem.use_case ?? "");
  const [modelType, setModelType]               = useState(aiSystem.model_type ?? "");
  const [dataClassification, setDataClassification] = useState(aiSystem.data_classification ?? "");
  const [deploymentStatus, setDeploymentStatus] = useState(aiSystem.deployment_status ?? "");
  const [criticality, setCriticality]           = useState(aiSystem.criticality ?? "");
  const [riskClassification, setRiskClassification] = useState(aiSystem.risk_classification ?? "");
  // ── Governance enrichment (T2-C/T2-D) ──
  const [euAiActTier, setEuAiActTier]           = useState(aiSystem.eu_ai_act_tier ?? "");
  const [humanOversight, setHumanOversight]     = useState(aiSystem.human_oversight_level ?? "");
  // null and [] are DIFFERENT facts on the wire: "never declared" vs "declared:
  // none". The declared flag keeps the form able to say either.
  const [sensitiveDeclared, setSensitiveDeclared] = useState(aiSystem.sensitive_data_categories !== null);
  const [sensitiveCategories, setSensitiveCategories] = useState<string[]>(aiSystem.sensitive_data_categories ?? []);
  const [businessOwner, setBusinessOwner]       = useState(aiSystem.business_owner_user_id ?? "");
  const [reviewCadenceDays, setReviewCadenceDays] = useState(
    aiSystem.review_cadence_days != null ? String(aiSystem.review_cadence_days) : ""
  );
  const [nextReviewDue, setNextReviewDue]       = useState(
    aiSystem.next_review_due ? aiSystem.next_review_due.slice(0, 10) : ""
  );
  const [saving, setSaving]                     = useState(false);
  const [error, setError]                       = useState<string | null>(null);
  const [deleting, setDeleting]                 = useState(false);
  const [deleteError, setDeleteError]           = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete]       = useState(false);

  function toggleSensitiveCategory(value: string) {
    setSensitiveCategories((prev) =>
      prev.includes(value) ? prev.filter((c) => c !== value) : [...prev, value]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("AI system name is required."); return; }
    const cadence = reviewCadenceDays.trim();
    if (cadence && (!/^\d+$/.test(cadence) || Number(cadence) <= 0)) {
      setError("Review cadence must be a positive number of days.");
      return;
    }
    setSaving(true);
    setError(null);

    const data: AiSystemEditData = {
      name:                name.trim(),
      use_case:            useCase.trim()            || null,
      model_type:          modelType.trim()          || null,
      data_classification: dataClassification        || null,
      deployment_status:   deploymentStatus          || null,
      criticality:         criticality               || null,
      risk_classification: riskClassification        || null,
      eu_ai_act_tier:            euAiActTier         || null,
      human_oversight_level:     humanOversight      || null,
      // Undeclared sends null; declared sends the list — [] means "declared: none".
      sensitive_data_categories: sensitiveDeclared ? sensitiveCategories : null,
      business_owner_user_id:    businessOwner       || null,
      review_cadence_days:       cadence ? Number(cadence) : null,
      next_review_due:           nextReviewDue       || null,
    };

    const result = await updateAiSystemAction(aiSystem.id, data);
    if (result && "error" in result) {
      setError(result.error);
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    setDeleteError(null);

    const result = await deleteAiSystemAction(aiSystem.id) as DeleteResult | never;
    if (result && "error" in result) {
      if (result.error === "has_reviews") {
        const d = result.details ?? {};
        const reviews = d.reviews ?? 0;
        setDeleteError(`Cannot delete: this AI system has ${reviews} governance review${reviews !== 1 ? "s" : ""}. Remove those first.`);
      } else {
        setDeleteError(result.error);
      }
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <>
      <form onSubmit={handleSubmit}>
        <div style={cardStyle} className="p-6 space-y-5">
          {/* Name */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#94a3b8" }}>
              Name <span style={{ color: "#fca5a5" }}>*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full rounded-lg px-3 py-2 text-sm border outline-none"
              style={inputStyle}
            />
          </div>

          {/* Use Case */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#94a3b8" }}>
              Use Case
            </label>
            <input
              type="text"
              value={useCase}
              onChange={(e) => setUseCase(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm border outline-none"
              style={inputStyle}
              placeholder="Describe how this AI system is used"
            />
          </div>

          {/* Model Type */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#94a3b8" }}>
              Model Type
            </label>
            <input
              type="text"
              value={modelType}
              onChange={(e) => setModelType(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm border outline-none"
              style={inputStyle}
              placeholder="e.g. GPT-4, Claude, Internal LLM"
            />
          </div>

          {/* Data Classification */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#94a3b8" }}>
              Data Classification
            </label>
            <select
              value={dataClassification}
              onChange={(e) => setDataClassification(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm border outline-none"
              style={inputStyle}
            >
              {DATA_CLASSIFICATION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value} style={{ background: "#0a0f1a" }}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {/* Deployment Status */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#94a3b8" }}>
              Deployment Status
            </label>
            <select
              value={deploymentStatus}
              onChange={(e) => setDeploymentStatus(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm border outline-none"
              style={inputStyle}
            >
              {DEPLOYMENT_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value} style={{ background: "#0a0f1a" }}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {/* Criticality */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#94a3b8" }}>
              Criticality
            </label>
            <select
              value={criticality}
              onChange={(e) => setCriticality(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm border outline-none"
              style={inputStyle}
            >
              {CRITICALITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value} style={{ background: "#0a0f1a" }}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {/* Risk Classification */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#94a3b8" }}>
              Risk Classification
            </label>
            <select
              value={riskClassification}
              onChange={(e) => setRiskClassification(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm border outline-none"
              style={inputStyle}
            >
              {RISK_CLASSIFICATION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value} style={{ background: "#0a0f1a" }}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {/* ── Governance (T2-C / T2-D) ─────────────────────────────── */}
          <div className="pt-4" style={{ borderTop: "1px solid #1e2d45" }}>
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#475569" }}>
              Governance
            </p>
            <p className="text-xs mt-1" style={{ color: "#475569" }}>
              Changing the regulatory tier, oversight model, sensitive data, use case,
              deployment status or criticality is a material change: it recommends
              reassessment, because prior assessments and use approvals then describe
              a different system.
            </p>
          </div>

          {/* EU AI Act tier */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#94a3b8" }}>
              EU AI Act Tier
            </label>
            <select
              value={euAiActTier}
              onChange={(e) => setEuAiActTier(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm border outline-none"
              style={inputStyle}
              aria-label="EU AI Act tier"
            >
              {EU_AI_ACT_TIER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value} style={{ background: "#0a0f1a" }}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {/* Human oversight level */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#94a3b8" }}>
              Human Oversight
            </label>
            <select
              value={humanOversight}
              onChange={(e) => setHumanOversight(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm border outline-none"
              style={inputStyle}
              aria-label="Human oversight level"
            >
              {HUMAN_OVERSIGHT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value} style={{ background: "#0a0f1a" }}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {/* Sensitive data categories — null vs [] are different declarations */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#94a3b8" }}>
              Sensitive Data Categories
            </label>
            <label className="flex items-center gap-2 text-sm mb-2" style={{ color: "#cbd5e1" }}>
              <input
                type="checkbox"
                checked={sensitiveDeclared}
                onChange={(e) => setSensitiveDeclared(e.target.checked)}
                aria-label="Sensitive data declared"
              />
              Declared — unchecked means the exposure has not been assessed, not that it is none
            </label>
            {sensitiveDeclared && (
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {SENSITIVE_DATA_OPTIONS.map((o) => (
                  <label key={o.value} className="flex items-center gap-1.5 text-sm" style={{ color: "#cbd5e1" }}>
                    <input
                      type="checkbox"
                      checked={sensitiveCategories.includes(o.value)}
                      onChange={() => toggleSensitiveCategory(o.value)}
                      aria-label={o.label}
                    />
                    {o.label}
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Business owner — accountable owner; owner_user_id stays the technical owner */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#94a3b8" }}>
              Business Owner
            </label>
            <select
              value={businessOwner}
              onChange={(e) => setBusinessOwner(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm border outline-none"
              style={inputStyle}
              aria-label="Business owner"
            >
              <option value="" style={{ background: "#0a0f1a" }}>— Unassigned —</option>
              {/* An already-set owner who is not in the (best-effort) member list must
                  stay selectable — otherwise opening the form would silently drop them. */}
              {businessOwner && !members.some((m) => m.id === businessOwner) && (
                <option value={businessOwner} style={{ background: "#0a0f1a" }}>
                  {businessOwner}
                </option>
              )}
              {members.map((m) => (
                <option key={m.id} value={m.id} style={{ background: "#0a0f1a" }}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>

          {/* Review cadence + next review due */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#94a3b8" }}>
                Review Cadence (days)
              </label>
              <input
                type="number"
                min={1}
                value={reviewCadenceDays}
                onChange={(e) => setReviewCadenceDays(e.target.value)}
                className="w-full rounded-lg px-3 py-2 text-sm border outline-none"
                style={inputStyle}
                placeholder="e.g. 90"
                aria-label="Review cadence in days"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide mb-1.5" style={{ color: "#94a3b8" }}>
                Next Review Due
              </label>
              <input
                type="date"
                value={nextReviewDue}
                onChange={(e) => setNextReviewDue(e.target.value)}
                className="w-full rounded-lg px-3 py-2 text-sm border outline-none"
                style={inputStyle}
                aria-label="Next review due"
              />
              <p className="text-xs mt-1" style={{ color: "#475569" }}>
                Left blank with a cadence set, the engine starts the clock from today.
              </p>
            </div>
          </div>

          {error && (
            <div
              className="rounded-lg px-4 py-3 text-sm"
              style={{ background: "rgba(239,68,68,0.12)", color: "#fca5a5", border: "1px solid rgba(239,68,68,0.25)" }}
            >
              {error}
            </div>
          )}
        </div>

        <div className="flex items-center gap-4 mt-6">
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2 rounded-lg text-sm font-semibold transition-colors hover:opacity-90 disabled:opacity-50"
            style={{ background: "#00c4b4", color: "#0a0f1a" }}
          >
            {saving ? "Saving…" : "Save Changes"}
          </button>
          <Link
            href={`/ai-systems/${aiSystem.id}`}
            className="text-sm font-medium transition-colors hover:opacity-80"
            style={{ color: "#94a3b8" }}
          >
            ← Back to AI System
          </Link>
        </div>
      </form>

      {/* Delete section */}
      <div className="mt-10 pt-8" style={{ borderTop: "1px solid #1e2d45" }}>
        <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "#475569" }}>
          Danger Zone
        </p>
        {!confirmDelete ? (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="text-xs font-medium transition-colors hover:opacity-80"
            style={{ color: "#f87171", background: "none", border: "none", cursor: "pointer", padding: 0 }}
          >
            Delete this AI system
          </button>
        ) : (
          <div
            className="rounded-lg px-4 py-4 space-y-3"
            style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}
          >
            <p className="text-sm font-medium" style={{ color: "#fca5a5" }}>
              Are you sure? This cannot be undone.
            </p>
            {deleteError && (
              <p className="text-xs" style={{ color: "#fca5a5" }}>{deleteError}</p>
            )}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                style={{ background: "#ef4444", color: "#fff" }}
              >
                {deleting ? "Deleting…" : "Yes, delete"}
              </button>
              <button
                type="button"
                onClick={() => { setConfirmDelete(false); setDeleteError(null); }}
                className="text-xs font-medium transition-colors hover:opacity-80"
                style={{ color: "#94a3b8", background: "none", border: "none", cursor: "pointer" }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
