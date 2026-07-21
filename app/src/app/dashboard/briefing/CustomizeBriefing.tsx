"use client";

/**
 * CustomizeBriefing — the Briefing personalization panel (Briefing Initiative
 * B2). Client-side presentation only: it receives the session's ELIGIBLE
 * modules (server-resolved — it can never offer a module the session cannot
 * see) and edits an ordered id list. Persistence goes through the server
 * actions; the engine re-validates everything against its own manifest.
 *
 * "Restore role default" saves the role default EXPLICITLY (a persisted
 * snapshot — spec ruling C2); Cancel discards edits. Never rendered for viewer
 * sessions (the platform-wide viewer-mutation block would 403 the save).
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { BriefingModuleDef, BriefingModuleId } from "@/lib/briefing/contracts";
import type { BriefingSuggestion } from "@/lib/briefing/layout";
import {
  saveBriefingLayoutAction,
} from "./briefingLayoutActions";

export type CustomizeBriefingProps = {
  eligible: BriefingModuleDef[];
  currentIds: string[];
  roleDefaultIds: BriefingModuleId[];
  suggestions: BriefingSuggestion[];
};

export function CustomizeBriefing(props: CustomizeBriefingProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [ids, setIds] = useState<BriefingModuleId[]>(
    () => props.currentIds.filter((id): id is BriefingModuleId =>
      props.eligible.some((d) => d.id === id)),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const byId = new Map(props.eligible.map((d) => [d.id, d]));
  const hidden = props.eligible.filter((d) => !ids.includes(d.id));

  function move(id: BriefingModuleId, delta: -1 | 1) {
    setIds((prev) => {
      const i = prev.indexOf(id);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  function save(nextIds: BriefingModuleId[]) {
    setError(null);
    startTransition(async () => {
      const result = await saveBriefingLayoutAction(nextIds);
      if (result.error) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-medium transition-colors"
        style={{ color: "#64748b" }}
        data-briefing-customize-open
      >
        Customize
      </button>
    );
  }

  return (
    <div
      className="rounded-xl border p-5 mb-8"
      style={{ background: "var(--color-brand-surface, #111827)", borderColor: "#334155" }}
      data-briefing-customize
    >
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-slate-200">Customize your Briefing</h2>
        <span className="text-xs" style={{ color: "#64748b" }}>
          Order and visibility only — every module keeps its scope label.
        </span>
      </div>

      {props.suggestions.length > 0 && (
        <div className="mb-4" data-briefing-suggestions>
          <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#64748b" }}>
            Suggested for you
          </p>
          {props.suggestions
            .filter((s) => !ids.includes(s.moduleId))
            .map((s) => (
              <div key={s.moduleId} className="flex items-center justify-between py-1">
                <span className="text-sm text-slate-300">
                  {byId.get(s.moduleId)?.title ?? s.moduleId}
                  <span className="ml-2 text-xs" style={{ color: "#94a3b8" }}>{s.reason}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setIds((prev) => [...prev, s.moduleId])}
                  className="text-xs font-medium"
                  style={{ color: "#00c4b4" }}
                >
                  Add
                </button>
              </div>
            ))}
        </div>
      )}

      <ul className="space-y-1 mb-3">
        {ids.map((id, i) => {
          const def = byId.get(id);
          if (!def) return null;
          return (
            <li key={id} className="flex items-center gap-2 py-1">
              <button
                type="button"
                aria-label={`Move ${def.title} up`}
                disabled={i === 0}
                onClick={() => move(id, -1)}
                className="text-xs px-1 disabled:opacity-30"
                style={{ color: "#94a3b8" }}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={`Move ${def.title} down`}
                disabled={i === ids.length - 1}
                onClick={() => move(id, 1)}
                className="text-xs px-1 disabled:opacity-30"
                style={{ color: "#94a3b8" }}
              >
                ↓
              </button>
              <span className="text-sm flex-1 text-slate-200">{def.title}</span>
              <span className="text-xs" style={{ color: "#64748b" }}>
                {def.scope === "personal" ? "You" : "Organization"}
              </span>
              <button
                type="button"
                onClick={() => setIds((prev) => prev.filter((x) => x !== id))}
                className="text-xs font-medium ml-2"
                style={{ color: "#94a3b8" }}
              >
                Hide
              </button>
            </li>
          );
        })}
      </ul>

      {hidden.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: "#64748b" }}>
            Hidden
          </p>
          {hidden.map((def) => (
            <div key={def.id} className="flex items-center justify-between py-1">
              <span className="text-sm" style={{ color: "#94a3b8" }}>{def.title}</span>
              <button
                type="button"
                onClick={() => setIds((prev) => [...prev, def.id])}
                className="text-xs font-medium"
                style={{ color: "#00c4b4" }}
              >
                Show
              </button>
            </div>
          ))}
        </div>
      )}

      {error && (
        <p className="text-xs mb-3" style={{ color: "#fca5a5" }} data-briefing-customize-error>
          {error}
        </p>
      )}

      <div className="flex items-center gap-4">
        <button
          type="button"
          disabled={pending || ids.length === 0}
          onClick={() => save(ids)}
          className="text-xs font-semibold px-3 py-1.5 rounded disabled:opacity-50"
          style={{ background: "#00c4b4", color: "#0f172a" }}
        >
          {pending ? "Saving…" : "Save layout"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => save([...props.roleDefaultIds])}
          className="text-xs font-medium disabled:opacity-50"
          style={{ color: "#94a3b8" }}
        >
          Restore role default
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            setIds(props.currentIds.filter((id): id is BriefingModuleId =>
              props.eligible.some((d) => d.id === id)));
            setError(null);
            setOpen(false);
          }}
          className="text-xs font-medium disabled:opacity-50"
          style={{ color: "#64748b" }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
