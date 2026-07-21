"use client";

/**
 * AssetManageActions — Edit / Archive / Delete controls for a detail-backed
 * registry asset (EAR P6). Only rendered for the four unified-CRUD-home types;
 * the detail page hides it entirely for vendor/ai_system/entity-backed assets
 * (EAR-AD-1 — those are managed on their own screens).
 *
 * Archive is a soft state change (PATCH status → archived) that keeps the asset
 * and its graph edges; Delete removes the backing row. Both go through the
 * /api/assets proxy; engine codes map via assetErrorMessage.
 */

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { updateAsset, deleteAsset } from "@/lib/api";
import { assetErrorMessage } from "@/lib/assetRegistry";

export function AssetManageActions({
  assetId,
  assetName,
  status,
}: {
  assetId: string;
  assetName: string;
  status: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isArchived = status === "archived" || status === "retired";

  function handleArchive() {
    setError(null);
    startTransition(async () => {
      const result = await updateAsset(assetId, { status: isArchived ? "active" : "archived" });
      if (!result.ok) {
        setError(assetErrorMessage(result.error));
        return;
      }
      router.refresh();
    });
  }

  function handleDelete() {
    setError(null);
    startTransition(async () => {
      const result = await deleteAsset(assetId);
      if (!result.ok) {
        setError(assetErrorMessage(result.error));
        setConfirming(false);
        return;
      }
      router.push("/assets");
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/assets/${assetId}/edit`}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-opacity hover:opacity-90"
          style={{ background: "#00c4b4", color: "#0a0f1a" }}
        >
          Edit
        </Link>
        <button
          type="button"
          onClick={handleArchive}
          disabled={isPending}
          className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors hover:opacity-80 disabled:opacity-50"
          style={{ borderColor: "#1e293b", color: "#94a3b8", background: "transparent" }}
        >
          {isPending ? "Working…" : isArchived ? "Reactivate" : "Archive"}
        </button>
        {!confirming && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors hover:opacity-80"
            style={{ borderColor: "rgba(239,68,68,0.3)", color: "#fca5a5", background: "transparent" }}
          >
            Delete
          </button>
        )}
      </div>

      {confirming && (
        <div
          className="rounded-lg border px-4 py-3 space-y-2"
          style={{ borderColor: "rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.06)" }}
        >
          <p className="text-xs" style={{ color: "#fca5a5" }}>
            Permanently delete <strong>{assetName}</strong>? This removes it from the registry and the
            enterprise graph. To keep history, use <strong>Archive</strong> instead.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleDelete}
              disabled={isPending}
              className="px-3 py-1.5 rounded text-xs font-semibold transition-opacity disabled:opacity-50 hover:opacity-80"
              style={{ background: "rgba(239,68,68,0.2)", color: "#fca5a5", border: "1px solid rgba(239,68,68,0.4)" }}
            >
              {isPending ? "Deleting…" : "Confirm Delete"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={isPending}
              className="px-3 py-1.5 rounded text-xs font-medium transition-opacity hover:opacity-80 disabled:opacity-50"
              style={{ color: "#64748b", border: "1px solid #1e293b", background: "transparent" }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="text-xs" style={{ color: "#fca5a5" }}>
          {error}
        </p>
      )}
    </div>
  );
}
