"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { IndustryTemplateDetail, IndustryTemplateId } from "@/lib/api";
import { loadTemplateAction } from "@/app/actions/loadTemplate";

/**
 * TemplatePreview — checkbox-driven preview of a single industry template.
 *
 * Selection state lives in component state (not URL). Earlier draft put
 * it in URL params for shareability, but the deselected-set serialization
 * for ~100 items per template hits URL length limits on some browsers
 * and adds complexity for a flow that's transient by nature (preview
 * for a few seconds, then load). If shareability becomes a real need,
 * revisit with a compact bitset encoding.
 *
 * All items default to checked. The Confirm button runs the server
 * action with the current set of CHECKED ids; the user is redirected
 * to /vendors with a success notice on success.
 */
export function TemplatePreview({ template }: { template: IndustryTemplateDetail }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Initial state: every id checked. Map<id, true> rather than Set
  // for cheap immutable updates via spread.
  const allIds = useMemo(() => {
    const ids: string[] = [];
    template.vendors.forEach((v)     => ids.push(v.id));
    template.obligations.forEach((o) => ids.push(o.id));
    template.controls.forEach((c)    => ids.push(c.id));
    template.ai_systems.forEach((a)  => ids.push(a.id));
    return ids;
  }, [template]);

  const [checked, setChecked] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const id of allIds) init[id] = true;
    return init;
  });

  function toggle(id: string) {
    setChecked((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function setAll(value: boolean, ids: string[]) {
    setChecked((prev) => {
      const next = { ...prev };
      for (const id of ids) next[id] = value;
      return next;
    });
  }

  const selectedIds = allIds.filter((id) => checked[id]);
  const counts = {
    vendors:     template.vendors.filter((v)     => checked[v.id]).length,
    obligations: template.obligations.filter((o) => checked[o.id]).length,
    controls:    template.controls.filter((c)    => checked[c.id]).length,
    ai_systems:  template.ai_systems.filter((a)  => checked[a.id]).length,
  };

  function onConfirm() {
    setError(null);
    startTransition(async () => {
      const result = await loadTemplateAction(
        template.id as IndustryTemplateId,
        selectedIds
      );
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Success — redirect to /vendors with a query param the page can
      // surface as a one-time success notice. Keep the inserted/skipped
      // counts in sessionStorage for the post-redirect notice; cleared
      // by the consumer.
      try {
        sessionStorage.setItem(
          "templates-load-result",
          JSON.stringify({
            industry_id: result.industry_id,
            inserted: result.inserted,
            skipped: result.skipped,
          })
        );
      } catch {
        // sessionStorage may be unavailable (private mode, embedded);
        // notice just won't appear, the load already happened.
      }
      router.push("/vendors?templates_loaded=1");
    });
  }

  return (
    <div>
      <Section
        title="Vendors"
        items={template.vendors}
        renderItem={(v) => (
          <Row
            key={v.id}
            id={v.id}
            checked={!!checked[v.id]}
            onToggle={() => toggle(v.id)}
            primary={v.name}
            secondary={`${v.criticality} · ${v.category}`}
            tertiary={v.description}
            needsReview={v.needs_review}
          />
        )}
        ids={template.vendors.map((v) => v.id)}
        setAll={setAll}
      />

      <Section
        title="Obligations"
        items={template.obligations}
        renderItem={(o) => (
          <Row
            key={o.id}
            id={o.id}
            checked={!!checked[o.id]}
            onToggle={() => toggle(o.id)}
            primary={o.regulation_name}
            secondary={`${o.jurisdiction} · ${o.priority}`}
            tertiary={o.description}
            needsReview={o.needs_review}
          />
        )}
        ids={template.obligations.map((o) => o.id)}
        setAll={setAll}
      />

      <Section
        title="Controls"
        items={template.controls}
        renderItem={(c) => (
          <Row
            key={c.id}
            id={c.id}
            checked={!!checked[c.id]}
            onToggle={() => toggle(c.id)}
            primary={c.name}
            secondary={c.framework_ref}
            tertiary={c.description}
            needsReview={c.needs_review}
          />
        )}
        ids={template.controls.map((c) => c.id)}
        setAll={setAll}
      />

      {/* Sticky confirm bar */}
      <div
        style={{
          position: "sticky",
          bottom: 0,
          marginTop: 32,
          padding: 16,
          background: "rgba(15,23,34,0.95)",
          borderTop: "1px solid rgba(255,255,255,0.08)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontSize: 13, color: "#d1d5db" }}>
          Load <strong>{counts.vendors}</strong> vendors,{" "}
          <strong>{counts.obligations}</strong> obligations,{" "}
          <strong>{counts.controls}</strong> controls into your inventory
          {counts.ai_systems > 0 ? `, ${counts.ai_systems} AI systems` : ""}.
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {error && (
            <span style={{ fontSize: 12, color: "#fca5a5" }}>
              {error}
            </span>
          )}
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending || selectedIds.length === 0}
            style={{
              padding: "8px 16px",
              background: selectedIds.length === 0 || isPending ? "#1e293b" : "#2563eb",
              color: "white",
              border: "1px solid #1d4ed8",
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 500,
              cursor: selectedIds.length === 0 || isPending ? "not-allowed" : "pointer",
            }}
          >
            {isPending ? "Loading..." : "Confirm and load"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Section<T>({
  title,
  items,
  renderItem,
  ids,
  setAll,
}: {
  title: string;
  items: T[];
  renderItem: (item: T) => React.ReactNode;
  ids: string[];
  setAll: (value: boolean, ids: string[]) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 12 }}>
        <h2 style={{ fontSize: 14, fontWeight: 600, color: "#e5e7eb", margin: 0 }}>
          {title} ({items.length})
        </h2>
        <button type="button" onClick={() => setAll(true, ids)} style={linkBtnStyle}>
          Select all
        </button>
        <button type="button" onClick={() => setAll(false, ids)} style={linkBtnStyle}>
          Deselect all
        </button>
      </div>
      <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        {items.map(renderItem)}
      </ul>
    </div>
  );
}

function Row({
  id,
  checked,
  onToggle,
  primary,
  secondary,
  tertiary,
  needsReview,
}: {
  id: string;
  checked: boolean;
  onToggle: () => void;
  primary: string;
  secondary: string;
  tertiary: string;
  needsReview?: boolean;
}) {
  return (
    <li
      style={{
        padding: "8px 12px",
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 6,
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
      }}
    >
      <input
        type="checkbox"
        id={id}
        checked={checked}
        onChange={onToggle}
        style={{ marginTop: 4, flexShrink: 0 }}
      />
      <label htmlFor={id} style={{ flex: 1, cursor: "pointer", display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 500, color: "#e5e7eb" }}>{primary}</span>
          <span style={{ fontSize: 11, color: "#9ca3af" }}>{secondary}</span>
          {needsReview && (
            <span
              style={{
                fontSize: 10,
                padding: "1px 6px",
                background: "rgba(245,158,11,0.08)",
                color: "#fcd34d",
                border: "1px solid rgba(245,158,11,0.2)",
                borderRadius: 999,
              }}
            >
              review
            </span>
          )}
        </div>
        {tertiary && (
          <div style={{ fontSize: 12, color: "#9ca3af", lineHeight: 1.4 }}>{tertiary}</div>
        )}
      </label>
    </li>
  );
}

const linkBtnStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#60a5fa",
  fontSize: 12,
  cursor: "pointer",
  padding: 0,
};
