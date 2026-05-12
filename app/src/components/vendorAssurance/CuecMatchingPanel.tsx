"use client";

/**
 * CuecMatchingPanel — the interactive body of the CUEC section: a "Re-match"
 * button (re-runs the LLM matcher against the current controls inventory) and
 * one CuecMappingCard per extracted CUEC. The cuecs/mappings data is fetched
 * server-side and passed in; the server actions revalidate the document path,
 * so a Re-match or a mapping change re-renders the page with fresh data.
 */

import { useState, useTransition } from "react";
import type { VendorAssuranceCuecsResponse, VendorAssuranceCuec } from "@/lib/api";
import { rematchDocumentCuecs } from "@/app/actions/vendorAssurance";
import CuecMappingCard from "./CuecMappingCard";

type Props = { documentId: string; data: VendorAssuranceCuecsResponse };

function cuecState(c: VendorAssuranceCuec): "mapped" | "no_match" | "needs_review" {
  if (c.review_status === "reviewed_no_match") return "no_match";
  if (c.mappings.some((m) => m.mapping_status === "accepted")) return "mapped";
  return "needs_review";
}

export default function CuecMatchingPanel({ documentId, data }: Props): JSX.Element {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const cuecs = data.cuecs;
  if (cuecs.length === 0) {
    return (
      <p style={{ color: "#9ca3af", fontSize: 13, margin: 0 }}>
        No complementary user entity controls were extracted from this report.
      </p>
    );
  }

  const counts = cuecs.reduce(
    (acc, c) => { acc[cuecState(c)]++; return acc; },
    { mapped: 0, no_match: 0, needs_review: 0 } as Record<"mapped" | "no_match" | "needs_review", number>
  );

  const onRematch = () => {
    setError(null);
    startTransition(async () => {
      const r = await rematchDocumentCuecs(documentId);
      if (!r.ok) setError(r.error);
    });
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
        <span style={{ fontSize: 12, color: "#9ca3af" }}>
          {cuecs.length} CUEC{cuecs.length === 1 ? "" : "s"} · {counts.mapped} mapped · {counts.no_match} no applicable control · {counts.needs_review} need review
        </span>
        <button
          type="button"
          onClick={onRematch}
          disabled={pending}
          title="Re-run the matcher against the current state of your controls inventory"
          style={{
            padding: "6px 12px",
            borderRadius: 6,
            border: "1px solid #374151",
            background: pending ? "#1f2937" : "transparent",
            color: pending ? "#6b7280" : "#93c5fd",
            cursor: pending ? "not-allowed" : "pointer",
            fontSize: 12,
          }}
        >
          {pending ? "Re-matching…" : "Re-match against inventory"}
        </button>
      </div>
      {error && <div style={{ marginBottom: 10, fontSize: 12, color: "#fca5a5" }}>{error}</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {cuecs.map((c) => (
          <CuecMappingCard key={c.id} documentId={documentId} cuec={c} highConfidenceThreshold={data.match_score_high_confidence} />
        ))}
      </div>
    </div>
  );
}
