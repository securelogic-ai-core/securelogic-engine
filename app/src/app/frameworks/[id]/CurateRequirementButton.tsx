"use client";

/**
 * CurateRequirementButton — VA-6. Inline editor for a requirement's CONTENT:
 * guidance (shown verbatim to external vendors in the portal questionnaire)
 * and scope tags (which decide what every tier-2/3/4 questionnaire asks).
 * Identity (reference_id, title) is immutable by engine contract.
 *
 * The tag vocabulary is passed down from the engine's coverage endpoint —
 * never duplicated here. Curation is admin-gated server-side; a non-admin
 * gets the engine's refusal surfaced as an error rather than a hidden button,
 * so the gate is honest instead of cosmetic.
 */

import { useState, useTransition } from "react";

import { curateRequirement } from "../actions";

export function CurateRequirementButton({
  requirementId,
  frameworkId,
  description,
  scopeTags,
  scopeTagsSource,
  vocabulary,
}: {
  requirementId: string;
  frameworkId: string;
  description: string | null;
  scopeTags: string[];
  scopeTagsSource: string | null;
  vocabulary: string[];
}) {
  const [open, setOpen] = useState(false);
  const [guidance, setGuidance] = useState(description ?? "");
  const [tags, setTags] = useState<string[]>(scopeTags);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggleTag = (tag: string) => {
    setTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag].sort()
    );
  };

  const save = () => {
    setError(null);
    startTransition(async () => {
      const result = await curateRequirement(
        requirementId,
        {
          description: guidance.trim().length > 0 ? guidance.trim() : null,
          scope_tags: tags,
        },
        frameworkId
      );
      if (result && "error" in result) {
        setError(result.error);
      } else {
        setOpen(false);
      }
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-medium hover:underline"
        style={{ color: "#00c4b4" }}
      >
        Curate content
      </button>
    );
  }

  return (
    <div
      className="mt-3 rounded-lg p-3 space-y-3"
      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
    >
      <div>
        <label
          className="block text-xs font-semibold mb-1"
          style={{ color: "#94a3b8" }}
        >
          Guidance (shown to the vendor in the portal)
        </label>
        <textarea
          value={guidance}
          onChange={(e) => setGuidance(e.target.value)}
          rows={3}
          maxLength={4000}
          className="w-full rounded-md px-2 py-1.5 text-sm"
          style={{
            background: "rgba(0,0,0,0.3)",
            border: "1px solid rgba(255,255,255,0.1)",
            color: "#e2e8f0",
          }}
          placeholder="What this control means and what evidence would satisfy it."
        />
      </div>

      <div>
        <label
          className="block text-xs font-semibold mb-1"
          style={{ color: "#94a3b8" }}
        >
          Scope tags{" "}
          <span style={{ color: "#64748b", fontWeight: 400 }}>
            (saving marks these curated
            {scopeTagsSource === "curated" ? "" : ` — currently ${scopeTagsSource ?? "untagged"}`})
          </span>
        </label>
        <div className="flex flex-wrap gap-1.5">
          {vocabulary.map((tag) => {
            const on = tags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() => toggleTag(tag)}
                className="px-2 py-0.5 rounded text-xs font-medium transition-opacity hover:opacity-80"
                style={
                  on
                    ? { background: "rgba(0,196,180,0.18)", color: "#00c4b4", border: "1px solid rgba(0,196,180,0.4)" }
                    : { background: "rgba(148,163,184,0.08)", color: "#94a3b8", border: "1px solid transparent" }
                }
              >
                {tag}
              </button>
            );
          })}
        </div>
      </div>

      {error ? (
        <p className="text-xs" style={{ color: "#fca5a5" }}>
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="px-3 py-1.5 rounded-md text-xs font-semibold transition-opacity hover:opacity-80 disabled:opacity-50"
          style={{ background: "#00c4b4", color: "#0a0f1a" }}
        >
          {pending ? "Saving…" : "Save curation"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
            setGuidance(description ?? "");
            setTags(scopeTags);
          }}
          className="text-xs hover:underline"
          style={{ color: "#94a3b8" }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
