"use client";

import { useState, useTransition } from "react";
import { saveAlertPreferences } from "./actions";
import type { AlertPreferences } from "@/lib/api";

interface Props {
  field: keyof AlertPreferences;
  label: string;
  description: string;
  initialValue: boolean;
}

export function AlertToggle({ field, label, description, initialValue }: Props) {
  const [enabled, setEnabled] = useState(initialValue);
  const [isPending, startTransition] = useTransition();

  function toggle() {
    const next = !enabled;
    setEnabled(next);
    startTransition(async () => {
      const result = await saveAlertPreferences({ [field]: next });
      if (!result.ok) {
        setEnabled(!next);
      }
    });
  }

  return (
    <div className="flex items-start justify-between gap-4 py-4" style={{ borderBottom: "1px solid #e2e8f0" }}>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-800">{label}</p>
        <p className="text-xs text-slate-500 mt-0.5">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={toggle}
        disabled={isPending}
        style={{
          flexShrink: 0,
          width: "44px",
          height: "24px",
          borderRadius: "12px",
          padding: "2px",
          border: "none",
          cursor: isPending ? "not-allowed" : "pointer",
          background: enabled ? "#0d9488" : "#cbd5e1",
          transition: "background 0.2s",
          opacity: isPending ? 0.6 : 1,
          position: "relative",
        }}
      >
        <span
          style={{
            display: "block",
            width: "20px",
            height: "20px",
            borderRadius: "50%",
            background: "#fff",
            boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
            transform: enabled ? "translateX(20px)" : "translateX(0)",
            transition: "transform 0.2s",
          }}
        />
      </button>
    </div>
  );
}
