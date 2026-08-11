"use client";

/**
 * VendorDependencyManager — add/remove vendor dependencies on an AI system
 * (EG2 slice 5). Renders under the read-only VendorDependenciesCard list; the
 * engine POST is idempotent on (org, ai_system, vendor, role) so a duplicate
 * add is a no-op, and role choices come from the canonical DEPENDENCY_ROLES
 * vocabulary (mirrored here as labels; the engine validates authoritatively).
 */

import { useState, useTransition } from "react";
import { addVendorDependency, removeVendorDependency } from "./dependencyActions";

export const ROLE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "model_provider", label: "Model provider" },
  { value: "runtime", label: "Runtime" },
  { value: "registry", label: "Registry" },
  { value: "training_data", label: "Training data" },
  { value: "feature_store", label: "Feature store" },
  { value: "mlops_platform", label: "MLOps platform" },
  { value: "data_source", label: "Data source" },
  { value: "observability", label: "Observability" },
  { value: "other", label: "Other" },
];

const INPUT_STYLE: React.CSSProperties = {
  background: "#0b1220",
  border: "1px solid #1e293b",
  color: "#e2e8f0",
  borderRadius: 6,
  padding: "6px 8px",
  fontSize: 12,
};

export function AddVendorDependencyForm({
  aiSystemId,
  vendors,
}: {
  aiSystemId: string;
  vendors: Array<{ id: string; name: string }>;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  // Controlled selects + click-to-submit — the codebase's client-mutation
  // idiom (see SavedViewsBar), which also keeps this drivable in jsdom.
  const [vendorId, setVendorId] = useState("");
  const [role, setRole] = useState("");

  if (vendors.length === 0) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 text-xs font-medium"
        style={{ color: "#00c4b4", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}
      >
        + Add vendor dependency
      </button>
    );
  }

  function submit() {
    if (!vendorId || !role || pending) return;
    setError(null);
    const formData = new FormData();
    formData.set("vendor_id", vendorId);
    formData.set("dependency_role", role);
    startTransition(async () => {
      const result = await addVendorDependency(aiSystemId, formData);
      if ("error" in result) setError(result.error);
      else {
        setOpen(false);
        setVendorId("");
        setRole("");
      }
    });
  }

  return (
    <div className="mt-3 flex items-center gap-2 flex-wrap">
      <select
        value={vendorId}
        onChange={(e) => setVendorId(e.target.value)}
        style={INPUT_STYLE}
        aria-label="Vendor"
      >
        <option value="" disabled>
          Vendor…
        </option>
        {vendors.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
          </option>
        ))}
      </select>
      <select
        value={role}
        onChange={(e) => setRole(e.target.value)}
        style={INPUT_STYLE}
        aria-label="Dependency role"
      >
        <option value="" disabled>
          Role…
        </option>
        {ROLE_OPTIONS.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={submit}
        disabled={pending || !vendorId || !role}
        className="text-xs font-medium px-3 py-1.5 rounded-md"
        style={{ background: "rgba(0,196,180,0.15)", color: "#00c4b4", border: "none", cursor: "pointer" }}
      >
        {pending ? "Adding…" : "Add"}
      </button>
      <button
        type="button"
        onClick={() => {
          setOpen(false);
          setError(null);
        }}
        className="text-xs"
        style={{ color: "#64748b", background: "transparent", border: "none", cursor: "pointer" }}
      >
        Cancel
      </button>
      {error && (
        <p className="w-full text-xs mt-1" style={{ color: "#fca5a5" }} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function RemoveVendorDependencyButton({
  dependencyId,
  aiSystemId,
  vendorId,
  vendorName,
}: {
  dependencyId: string;
  aiSystemId: string;
  vendorId: string;
  vendorName: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      aria-label={`Remove dependency on ${vendorName}`}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await removeVendorDependency(dependencyId, aiSystemId, vendorId);
        })
      }
      className="text-xs opacity-50 hover:opacity-100"
      style={{ color: "#94a3b8", background: "transparent", border: "none", cursor: "pointer", padding: "0 2px" }}
    >
      ✕
    </button>
  );
}
