"use client";

/**
 * AssetForm — shared create/edit form for the four DETAIL-BACKED asset types
 * (cloud_resource / endpoint / api / identity_system — EAR P6). The unified
 * /assets surface is their CRUD home; every other type is managed on its own
 * screen (EAR-AD-1), so this form never renders for vendor/ai_system/entity
 * kinds. Fields are driven entirely by DETAIL_TYPE_FIELDS, which mirrors the
 * engine validator — the UI can only offer values the engine accepts.
 *
 * Writes go through the /api/assets Next proxy (createAsset / updateAsset);
 * engine error codes map to human copy via assetErrorMessage. asset_type is
 * immutable after creation, so edit mode shows it read-only.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createAsset, updateAsset } from "@/lib/api";
import {
  DETAIL_TYPE_FIELDS,
  ASSET_CRITICALITIES,
  ASSET_STATUSES,
  assetTypeLabel,
  assetErrorMessage,
  type DetailBackedType,
} from "@/lib/assetRegistry";
import { titleFromSnake } from "@/lib/enterpriseContextFormat";

const inputClass = "w-full rounded-lg px-3 py-2 text-sm border outline-none transition-colors";
const inputStyle = { background: "#0a0f1a", borderColor: "#1e2d45", color: "#f1f5f9" };
const labelClass = "block text-xs font-semibold uppercase tracking-wide mb-1.5";

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className={labelClass} style={{ color: "#94a3b8" }}>
      {children}
      {required && <span style={{ color: "#fca5a5" }}> *</span>}
    </label>
  );
}

/** Trimmed value or undefined (create: omit empties). */
function opt(fd: FormData, key: string): string | undefined {
  const v = fd.get(key);
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s : undefined;
}
/** Trimmed value or explicit null (edit: empty CLEARS a nullable column). */
function optOrNull(fd: FormData, key: string): string | null {
  return opt(fd, key) ?? null;
}

export type AssetInitial = {
  name: string;
  criticality: string | null;
  status: string | null;
  external_ref: string | null;
  typed: Record<string, string | null>;
};

export default function AssetForm(
  props:
    | { mode: "create"; assetType: DetailBackedType }
    | { mode: "edit"; assetId: string; assetType: DetailBackedType; initial: AssetInitial },
) {
  const router = useRouter();
  const isEdit = props.mode === "edit";
  const assetType = props.assetType;
  const initial = isEdit ? props.initial : null;
  const fields = DETAIL_TYPE_FIELDS[assetType];

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const fd = new FormData(e.currentTarget);
    const name = ((fd.get("name") as string | null) ?? "").trim();
    if (!name) {
      setError("Name is required.");
      setSubmitting(false);
      return;
    }

    let result;
    if (isEdit) {
      // PATCH: send full form state; cleared optional fields go as explicit null.
      const patch: Record<string, string | null> = {
        name,
        criticality: optOrNull(fd, "criticality"),
        status: opt(fd, "status") ?? "active",
        external_ref: optOrNull(fd, "external_ref"),
      };
      for (const f of fields) {
        // A required typed column (provider) must not be cleared.
        patch[f.field] = f.required ? opt(fd, f.field) ?? initial!.typed[f.field] ?? null : optOrNull(fd, f.field);
      }
      result = await updateAsset(props.assetId, patch);
    } else {
      const input: Record<string, string | undefined> & { asset_type: DetailBackedType; name: string } = {
        asset_type: assetType,
        name,
        criticality: opt(fd, "criticality"),
        external_ref: opt(fd, "external_ref"),
      };
      for (const f of fields) input[f.field] = opt(fd, f.field);
      result = await createAsset(input);
    }

    if (!result.ok) {
      setError(assetErrorMessage(result.error));
      setSubmitting(false);
      return;
    }

    router.push(`/assets/${result.asset.asset_id}`);
    router.refresh();
  }

  return (
    <div className="bg-brand-surface border border-brand-line rounded-xl p-6">
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Type — immutable after creation */}
        <div>
          <FieldLabel required>Type</FieldLabel>
          <p className="text-sm py-2" style={{ color: "#cbd5e1" }}>
            {assetTypeLabel(assetType)}
            {isEdit && (
              <span className="text-xs ml-2" style={{ color: "#64748b" }}>
                (type can&apos;t be changed after creation)
              </span>
            )}
          </p>
        </div>

        {/* Name */}
        <div>
          <FieldLabel required>Name</FieldLabel>
          <input
            type="text"
            name="name"
            required
            maxLength={200}
            defaultValue={initial?.name ?? ""}
            placeholder="e.g. prod-payments-db, sso.acme.com"
            className={inputClass}
            style={inputStyle}
            disabled={submitting}
          />
        </div>

        {/* Criticality + Status */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <FieldLabel>Criticality</FieldLabel>
            <select
              name="criticality"
              defaultValue={initial?.criticality ?? ""}
              className={inputClass}
              style={inputStyle}
              disabled={submitting}
            >
              <option value="">Not set</option>
              {ASSET_CRITICALITIES.map((c) => (
                <option key={c} value={c}>
                  {titleFromSnake(c)}
                </option>
              ))}
            </select>
          </div>
          {/* Status is editable only in edit mode; new assets are active. */}
          {isEdit && (
            <div>
              <FieldLabel>Status</FieldLabel>
              <select
                name="status"
                defaultValue={initial?.status ?? "active"}
                className={inputClass}
                style={inputStyle}
                disabled={submitting}
              >
                {ASSET_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {titleFromSnake(s)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Typed columns for this type */}
        <fieldset className="rounded-lg border p-4 space-y-4" style={{ borderColor: "#1e2d45" }}>
          <legend className="text-xs font-semibold uppercase tracking-wide px-1" style={{ color: "#94a3b8" }}>
            {assetTypeLabel(assetType)} Attributes
          </legend>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {fields.map((f) => (
              <div key={f.field}>
                <FieldLabel required={f.required}>{f.label}</FieldLabel>
                {f.options ? (
                  <select
                    name={f.field}
                    required={f.required}
                    defaultValue={initial?.typed[f.field] ?? ""}
                    className={inputClass}
                    style={inputStyle}
                    disabled={submitting}
                  >
                    {!f.required && <option value="">Not set</option>}
                    {f.required && (
                      <option value="" disabled>
                        Select…
                      </option>
                    )}
                    {f.options.map((o) => (
                      <option key={o} value={o}>
                        {titleFromSnake(o)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    name={f.field}
                    maxLength={200}
                    defaultValue={initial?.typed[f.field] ?? ""}
                    className={inputClass}
                    style={inputStyle}
                    disabled={submitting}
                  />
                )}
              </div>
            ))}
          </div>
        </fieldset>

        {/* External ref */}
        <div>
          <FieldLabel>External Reference</FieldLabel>
          <input
            type="text"
            name="external_ref"
            maxLength={200}
            defaultValue={initial?.external_ref ?? ""}
            placeholder="e.g. CMDB sys_id, connector ref"
            className={inputClass}
            style={inputStyle}
            disabled={submitting}
          />
        </div>

        {error && (
          <div
            className="rounded-lg border px-4 py-3 text-sm"
            style={{ borderColor: "rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.06)", color: "#fca5a5" }}
          >
            {error}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: "#00c4b4", color: "#0a0f1a" }}
          >
            {submitting ? "Saving…" : isEdit ? "Save Changes" : "Create Asset"}
          </button>
          <Link
            href={isEdit ? `/assets/${props.assetId}` : "/assets/new"}
            className="px-4 py-2 rounded-lg text-sm font-medium border transition-colors hover:opacity-80"
            style={{ borderColor: "#1e293b", color: "#94a3b8" }}
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
