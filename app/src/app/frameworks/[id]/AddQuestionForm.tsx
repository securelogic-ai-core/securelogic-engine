"use client";

/**
 * AddQuestionForm — VA-6 customer questions. An org can add its own question
 * to a framework it owns; the engine derives heuristic scope tags at creation
 * so the question participates in vendor questionnaire scoping from birth
 * (previously a custom question landed with empty tags and was invisible to
 * every tier-2/3/4 questionnaire forever).
 */

import { useState, useTransition } from "react";

import { createRequirement } from "../actions";

export function AddQuestionForm({ frameworkId }: { frameworkId: string }) {
  const [open, setOpen] = useState(false);
  const [referenceId, setReferenceId] = useState("");
  const [title, setTitle] = useState("");
  const [guidance, setGuidance] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const result = await createRequirement({
        framework_id: frameworkId,
        reference_id: referenceId.trim(),
        title: title.trim(),
        ...(guidance.trim().length > 0 ? { description: guidance.trim() } : {}),
      });
      if (result && "error" in result) {
        setError(result.error);
      } else {
        setOpen(false);
        setReferenceId("");
        setTitle("");
        setGuidance("");
      }
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold transition-opacity hover:opacity-80"
        style={{ background: "rgba(0,196,180,0.12)", color: "#00c4b4", border: "1px solid rgba(0,196,180,0.3)" }}
      >
        + Add custom question
      </button>
    );
  }

  const inputStyle: React.CSSProperties = {
    background: "rgba(0,0,0,0.3)",
    border: "1px solid rgba(255,255,255,0.1)",
    color: "#e2e8f0",
  };

  return (
    <div
      className="rounded-xl p-4 space-y-3"
      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
    >
      <p className="text-sm font-semibold" style={{ color: "#f1f5f9" }}>
        Add a custom question
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <input
          value={referenceId}
          onChange={(e) => setReferenceId(e.target.value)}
          placeholder="Reference (e.g. CUSTOM-1)"
          className="rounded-md px-2 py-1.5 text-sm"
          style={inputStyle}
        />
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Question title"
          className="rounded-md px-2 py-1.5 text-sm sm:col-span-2"
          style={inputStyle}
        />
      </div>
      <textarea
        value={guidance}
        onChange={(e) => setGuidance(e.target.value)}
        rows={2}
        maxLength={4000}
        placeholder="Guidance for the vendor (optional): what this asks for and what evidence would satisfy it."
        className="w-full rounded-md px-2 py-1.5 text-sm"
        style={inputStyle}
      />
      {error ? (
        <p className="text-xs" style={{ color: "#fca5a5" }}>
          {error}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending || referenceId.trim().length === 0 || title.trim().length === 0}
          className="px-3 py-1.5 rounded-md text-xs font-semibold transition-opacity hover:opacity-80 disabled:opacity-50"
          style={{ background: "#00c4b4", color: "#0a0f1a" }}
        >
          {pending ? "Adding…" : "Add question"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
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
