"use client";

/**
 * EntityForm — shared create/edit form for enterprise entities (goal Item 7, 7A.2).
 * Mutations go through the 7A.1 client (Next proxy routes); engine error codes are
 * mapped to human copy via enterpriseContextErrorMessage. entity_type is immutable
 * after creation (engine: entity_type_immutable), so edit mode shows it read-only.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createEnterpriseEntity,
  updateEnterpriseEntity,
  type EnterpriseEntityCreateInput,
  type EnterpriseEntityUpdateInput,
} from "@/lib/api";
import {
  CRITICALITIES,
  CONFIDENCES,
  DATA_CLASSIFICATIONS,
  ENTITY_STATUSES,
  ENTITY_TYPES,
  enterpriseContextErrorMessage,
  type EnterpriseEntity,
  type EntityType,
} from "@/lib/enterpriseContext";
import { entityTypeLabel, titleFromSnake } from "@/lib/enterpriseContextFormat";

const inputClass =
  "w-full rounded-lg px-3 py-2 text-sm border outline-none transition-colors";
const inputStyle = {
  background: "#0a0f1a",
  borderColor: "#1e2d45",
  color: "#f1f5f9",
};
const labelClass = "block text-xs font-semibold uppercase tracking-wide mb-1.5";

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label className={labelClass} style={{ color: "#94a3b8" }}>
      {children}
      {required && <span style={{ color: "#fca5a5" }}> *</span>}
    </label>
  );
}

function optional(v: FormDataEntryValue | null): string | undefined {
  const s = typeof v === "string" ? v.trim() : "";
  return s.length > 0 ? s : undefined;
}

/** Edit-mode variant: empty selection must CLEAR the stored value → explicit null. */
function optionalOrNull(v: FormDataEntryValue | null): string | null {
  return optional(v) ?? null;
}

export default function EntityForm({
  entity,
  presetType,
  lockType,
  cancelHref,
}: {
  entity?: EnterpriseEntity;
  /** Preselect the type (e.g. registry routed here for a specific asset type). */
  presetType?: EntityType;
  /** Lock the type read-only so it is never re-selected (registry chose it). */
  lockType?: boolean;
  /** Where Cancel returns to (defaults to /enterprise-context). */
  cancelHref?: string;
}) {
  const router = useRouter();
  const isEdit = !!entity;
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [entityType, setEntityType] = useState<EntityType>(
    entity?.entity_type ?? presetType ?? "asset",
  );

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

    // encryption select: "" → unknown (omit → null), "true"/"false" → explicit boolean
    const encRaw = fd.get("encryption_at_rest");
    const encryption_at_rest =
      encRaw === "true" ? true : encRaw === "false" ? false : undefined;

    let result;
    if (isEdit) {
      // PATCH: supplied keys replace the stored value, so send the FULL form state —
      // cleared optional fields go as explicit null (empty string is invalid for enums).
      const input: EnterpriseEntityUpdateInput = {
        name,
        description: optionalOrNull(fd.get("description")),
        status: optional(fd.get("status")),
        criticality: optionalOrNull(fd.get("criticality")),
        confidence: optionalOrNull(fd.get("confidence")),
        external_ref: optionalOrNull(fd.get("external_ref")),
      };
      if (entityType === "data_store") {
        // data_store replaces all four attributes; omitted attrs become null
        input.data_store = {
          data_classification: optionalOrNull(fd.get("data_classification")),
          residency_region: optionalOrNull(fd.get("residency_region")),
          retention_policy: optionalOrNull(fd.get("retention_policy")),
          ...(encryption_at_rest !== undefined ? { encryption_at_rest } : {}),
        };
      }
      result = await updateEnterpriseEntity(entity.id, input);
    } else {
      const input: EnterpriseEntityCreateInput = {
        entity_type: entityType,
        name,
        description: optional(fd.get("description")),
        criticality: optional(fd.get("criticality")),
        confidence: optional(fd.get("confidence")),
        external_ref: optional(fd.get("external_ref")),
      };
      if (entityType === "data_store") {
        input.data_store = {
          data_classification: optional(fd.get("data_classification")),
          residency_region: optional(fd.get("residency_region")),
          retention_policy: optional(fd.get("retention_policy")),
          ...(encryption_at_rest !== undefined ? { encryption_at_rest } : {}),
        };
      }
      result = await createEnterpriseEntity(input);
    }

    if (!result.ok) {
      setError(enterpriseContextErrorMessage(result.error));
      setSubmitting(false);
      return;
    }

    router.push(`/enterprise-context/entities/${result.enterprise_entity.id}`);
    router.refresh();
  }

  return (
    <div className="bg-brand-surface border border-brand-line rounded-xl p-6">
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Entity type — immutable after creation */}
        <div>
          <FieldLabel required>Type</FieldLabel>
          {isEdit || lockType ? (
            <p className="text-sm py-2" style={{ color: "#cbd5e1" }}>
              {entityTypeLabel(isEdit ? entity.entity_type : entityType)}
              <span className="text-xs ml-2" style={{ color: "#64748b" }}>
                {isEdit
                  ? "(type can't be changed after creation)"
                  : "(selected on the Asset Registry)"}
              </span>
            </p>
          ) : (
            <select
              name="entity_type"
              value={entityType}
              onChange={(e) => setEntityType(e.target.value as EntityType)}
              className={inputClass}
              style={inputStyle}
              disabled={submitting}
            >
              {ENTITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {entityTypeLabel(t)}
                </option>
              ))}
            </select>
          )}
        </div>

        {/* Name */}
        <div>
          <FieldLabel required>Name</FieldLabel>
          <input
            type="text"
            name="name"
            required
            maxLength={200}
            defaultValue={entity?.name ?? ""}
            placeholder="e.g. Payments API, Customer DB, Finance"
            className={inputClass}
            style={inputStyle}
            disabled={submitting}
          />
        </div>

        {/* Description */}
        <div>
          <FieldLabel>Description</FieldLabel>
          <textarea
            name="description"
            rows={3}
            maxLength={2000}
            defaultValue={entity?.description ?? ""}
            className={inputClass}
            style={inputStyle}
            disabled={submitting}
          />
        </div>

        {/* Criticality + Confidence */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <FieldLabel>Criticality</FieldLabel>
            <select
              name="criticality"
              defaultValue={entity?.criticality ?? ""}
              className={inputClass}
              style={inputStyle}
              disabled={submitting}
            >
              <option value="">Not set</option>
              {CRITICALITIES.map((c) => (
                <option key={c} value={c}>
                  {titleFromSnake(c)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <FieldLabel>Confidence</FieldLabel>
            <select
              name="confidence"
              defaultValue={entity?.confidence ?? ""}
              className={inputClass}
              style={inputStyle}
              disabled={submitting}
            >
              <option value="">Not set</option>
              {CONFIDENCES.map((c) => (
                <option key={c} value={c}>
                  {titleFromSnake(c)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Status (edit only — new entities are active) */}
        {isEdit && (
          <div>
            <FieldLabel>Status</FieldLabel>
            <select
              name="status"
              defaultValue={entity.status}
              className={inputClass}
              style={inputStyle}
              disabled={submitting}
            >
              {ENTITY_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {titleFromSnake(s)}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* External ref */}
        <div>
          <FieldLabel>External Reference</FieldLabel>
          <input
            type="text"
            name="external_ref"
            maxLength={500}
            defaultValue={entity?.external_ref ?? ""}
            placeholder="e.g. CMDB sys_id, asset tag"
            className={inputClass}
            style={inputStyle}
            disabled={submitting}
          />
        </div>

        {/* Data-store attributes */}
        {entityType === "data_store" && (
          <fieldset
            className="rounded-lg border p-4 space-y-4"
            style={{ borderColor: "#1e2d45" }}
          >
            <legend className="text-xs font-semibold uppercase tracking-wide px-1" style={{ color: "#94a3b8" }}>
              Data Store Attributes
            </legend>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <FieldLabel>Data Classification</FieldLabel>
                <select
                  name="data_classification"
                  defaultValue={entity?.data_classification ?? ""}
                  className={inputClass}
                  style={inputStyle}
                  disabled={submitting}
                >
                  <option value="">Not set</option>
                  {DATA_CLASSIFICATIONS.map((c) => (
                    <option key={c} value={c}>
                      {titleFromSnake(c)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <FieldLabel>Residency Region</FieldLabel>
                <input
                  type="text"
                  name="residency_region"
                  maxLength={100}
                  defaultValue={entity?.residency_region ?? ""}
                  placeholder="e.g. us-east-1, EU"
                  className={inputClass}
                  style={inputStyle}
                  disabled={submitting}
                />
              </div>
            </div>
            <div>
              <FieldLabel>Retention Policy</FieldLabel>
              <input
                type="text"
                name="retention_policy"
                maxLength={500}
                defaultValue={entity?.retention_policy ?? ""}
                placeholder="e.g. 7 years, delete on contract end"
                className={inputClass}
                style={inputStyle}
                disabled={submitting}
              />
            </div>
            <div>
              <FieldLabel>Encrypted at Rest</FieldLabel>
              <select
                name="encryption_at_rest"
                defaultValue={
                  entity?.encryption_at_rest === true
                    ? "true"
                    : entity?.encryption_at_rest === false
                    ? "false"
                    : ""
                }
                className={inputClass}
                style={inputStyle}
                disabled={submitting}
              >
                <option value="">Unknown</option>
                <option value="true">Yes</option>
                <option value="false">No</option>
              </select>
            </div>
          </fieldset>
        )}

        {error && (
          <div
            className="rounded-lg border px-4 py-3 text-sm"
            style={{
              borderColor: "rgba(239,68,68,0.3)",
              background: "rgba(239,68,68,0.06)",
              color: "#fca5a5",
            }}
          >
            {error}
          </div>
        )}

        <div className="flex items-center gap-3 pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: "#00c4b4", color: "#0a0f1a" }}
          >
            {submitting ? "Saving…" : isEdit ? "Save Changes" : "Create Entity"}
          </button>
          <Link
            href={
              isEdit
                ? `/enterprise-context/entities/${entity.id}`
                : (cancelHref ?? "/enterprise-context")
            }
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
