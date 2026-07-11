"use client";

import { useState, useTransition } from "react";
import { createRemediationAction } from "./actions";

const PRIORITY_OPTIONS = [
  { value: "immediate", label: "Immediate" },
  { value: "near_term", label: "Near Term" },
  { value: "planned",   label: "Planned" },
  { value: "watch",     label: "Watch" },
];

const fieldStyle: React.CSSProperties = {
  background: "rgba(15,23,42,0.6)",
  border: "1px solid #1e293b",
  borderRadius: "8px",
  color: "#f1f5f9",
  padding: "7px 10px",
  fontSize: "13px",
  width: "100%",
  outline: "none",
};

export interface OwnerOption {
  id: string;
  label: string;
}

interface Props {
  findingId: string;
  /** Org members, for assigning the work at the moment you create it. */
  owners?: OwnerOption[];
}

export function AddActionForm({ findingId, owners = [] }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("planned");
  const [dueDate, setDueDate] = useState("");
  // POST /api/actions has always accepted owner_user_id; the form never sent it, so
  // every remediation action was born unassigned. Assigning at creation is the
  // natural moment — it is when you know who is doing the work.
  const [ownerUserId, setOwnerUserId] = useState("");
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setTitle("");
    setDescription("");
    setPriority("planned");
    setDueDate("");
    setOwnerUserId("");
    setError(null);
    setIsOpen(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await createRemediationAction(findingId, {
        title: title.trim(),
        description: description.trim() || undefined,
        priority,
        due_date: dueDate || undefined,
        owner_user_id: ownerUserId || null,
      });
      if (result.error) {
        setError(result.error);
      } else {
        reset();
      }
    });
  }

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
        style={{ border: "1px solid rgba(0,196,180,0.4)", color: "#00c4b4", background: "transparent" }}
      >
        + Add Remediation Action
      </button>
    );
  }

  return (
    <div
      className="rounded-lg mt-3"
      style={{ background: "rgba(15,23,42,0.6)", border: "1px solid #1e293b", padding: "14px" }}
    >
      <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "#94a3b8" }}>
        New Remediation Action
      </p>

      <form onSubmit={handleSubmit} className="space-y-3">
        {error && (
          <p className="text-xs" style={{ color: "#fca5a5" }}>{error}</p>
        )}

        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: "#94a3b8" }}>
            Title *
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Patch vulnerable dependency"
            autoFocus
            style={fieldStyle}
          />
        </div>

        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: "#94a3b8" }}>
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe what needs to be done"
            rows={2}
            style={{ ...fieldStyle, resize: "vertical" }}
          />
        </div>

        {owners.length > 0 && (
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: "#94a3b8" }}>
              Owner
            </label>
            <select
              value={ownerUserId}
              onChange={(e) => setOwnerUserId(e.target.value)}
              style={fieldStyle}
            >
              <option value="">Unassigned</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium mb-2" style={{ color: "#94a3b8" }}>
            Priority
          </label>
          <div className="flex gap-2 flex-wrap">
            {PRIORITY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setPriority(opt.value)}
                className="px-3 py-1 rounded text-xs font-medium transition-colors"
                style={
                  priority === opt.value
                    ? { border: "1px solid #00c4b4", background: "rgba(0,196,180,0.08)", color: "#00c4b4" }
                    : { border: "1px solid #1e293b", color: "#64748b", background: "transparent" }
                }
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: "#94a3b8" }}>
            Due Date
          </label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            style={fieldStyle}
          />
        </div>

        <div className="flex items-center gap-3 pt-1">
          <button
            type="submit"
            disabled={isPending}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
            style={{ background: "#00c4b4", color: "#0a0f1a" }}
          >
            {isPending ? "Adding…" : "Add Action"}
          </button>
          <button
            type="button"
            onClick={reset}
            className="text-xs font-medium transition-colors"
            style={{ color: "#64748b" }}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
