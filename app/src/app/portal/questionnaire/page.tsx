"use client";

/**
 * /portal/questionnaire — the scoped controls list.
 *
 * GET /api/vendor-portal/questions returns the engagement's FROZEN scope with
 * each question's rule trace ("why we're asking") and the vendor's answers so
 * far. Answers save one-at-a-time via PUT /questions/:requirementId with an
 * optimistic update and rollback on error.
 *
 * Read-only semantics mirror the engine exactly: once the engagement is no
 * longer accepting responses the controls are disabled, and a 409
 * (responses_closed) from a save — e.g. submitted in another tab — rolls the
 * answer back and locks the form with the engine's own message.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePortal } from "../PortalShell";
import {
  ANSWER_OPTIONS,
  EXPLANATION_PROMPT,
  depthLabel,
  errorMessage,
  explanationRequiredForAnswer,
  portalFetch,
  type PortalEvidenceFile,
  type PortalQuestion,
  type ScopeReason,
} from "../portalApi";

type LoadState =
  | { phase: "loading" }
  | { phase: "error" }
  | { phase: "ready" };

type ItemState = {
  /** What the vendor currently sees (optimistic). */
  answer: string | null;
  notes: string;
  /** Last state confirmed by the engine — the rollback target. */
  savedAnswer: string | null;
  savedNotes: string;
  saving: boolean;
  saved: boolean;
  error: string | null;
};

function initialItemState(q: PortalQuestion): ItemState {
  return {
    answer: q.answer,
    notes: q.notes ?? "",
    savedAnswer: q.answer,
    savedNotes: q.notes ?? "",
    saving: false,
    saved: false,
    error: null,
  };
}

/**
 * Attachments for ONE question (WA-1).
 *
 * The evidence a vendor is being asked for belongs beside the question that
 * asks for it. Before this, upload lived only on /portal/evidence behind a
 * requirement dropdown, which is why the owner's walkthrough produced 37
 * answers and zero artifacts — and why every control scored at `asserted`, the
 * weakest rung of the effectiveness ladder.
 *
 * This is the SAME canonical endpoint the library page posts to
 * (POST /vendor-portal/evidence -> the `evidence` table with engagement_id +
 * requirement_id). No second attachment model, no second storage path, no
 * second validator — only a second place to reach the one that exists.
 */
function QuestionEvidence({
  requirementId,
  files,
  readOnly,
  required,
  onChanged,
  onUnauthorized,
}: {
  requirementId: string;
  files: PortalEvidenceFile[];
  readOnly: boolean;
  required: boolean;
  onChanged: () => Promise<void>;
  onUnauthorized: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("requirement_id", requirementId);
      // No Content-Type header: the browser sets the multipart boundary.
      const result = await portalFetch("/evidence", { method: "POST", body: form });
      if (result.status === 401) {
        onUnauthorized();
        return;
      }
      if (result.status === 201) {
        if (inputRef.current) inputRef.current.value = "";
        await onChanged();
        return;
      }
      // 413 quota/size, 415 type, 409 closed, 503 storage — engine text verbatim,
      // because those messages name the exact limits.
      setError(errorMessage(result, "The file could not be attached. Please try again."));
    } catch {
      setError("Network problem — the file was not attached. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3">
      <div className="mb-1 flex flex-wrap items-baseline gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Supporting evidence {required ? "(required)" : "(optional)"}
        </span>
        {files.length > 0 && (
          <span className="text-xs text-slate-500">
            {files.length} attached
          </span>
        )}
      </div>

      {files.length > 0 && (
        <ul className="mb-2 space-y-1">
          {files.map((f) => (
            <li key={f.id} className="text-xs text-slate-300">
              <span className="mr-2 text-slate-500">•</span>
              {f.filename}
            </li>
          ))}
        </ul>
      )}

      {!readOnly && (
        <input
          ref={inputRef}
          type="file"
          disabled={busy}
          aria-label={`Attach evidence for ${requirementId}`}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
          className="block w-full text-xs text-slate-400 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-line file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-200 hover:file:opacity-90 disabled:opacity-60"
        />
      )}

      {busy && <p className="mt-1 text-xs text-slate-500">Attaching…</p>}
      {error && (
        <p className="mt-2 rounded-lg border border-red-500/40 bg-red-500/10 p-2 text-xs leading-5 text-red-300">
          {error}
        </p>
      )}
      {!readOnly && (
        <p className="mt-1 text-xs text-slate-600">
          Attaching here links the document to this question.{" "}
          <Link href="/portal/evidence" className="underline hover:text-slate-400">
            Manage all documents
          </Link>
          .
        </p>
      )}
    </div>
  );
}

function WhyWeAreAsking({ reasons }: { reasons: ScopeReason[] | null }) {
  if (!reasons || reasons.length === 0) return null;
  return (
    <details className="mt-3 rounded-lg border border-brand-line bg-brand-bg p-3">
      <summary className="cursor-pointer text-xs font-medium text-slate-400 hover:text-slate-200">
        Why we&apos;re asking
      </summary>
      <ul className="mt-2 list-disc space-y-1.5 pl-4">
        {reasons.map((r, i) => (
          <li key={`${r.rationale}-${i}`} className="text-xs leading-5 text-slate-300">
            {r.rationale}
          </li>
        ))}
      </ul>
    </details>
  );
}

export default function QuestionnairePage() {
  const { engagement, onUnauthorized, reloadEngagement } = usePortal();
  const [load, setLoad] = useState<LoadState>({ phase: "loading" });
  const [questions, setQuestions] = useState<PortalQuestion[]>([]);
  const [items, setItems] = useState<Record<string, ItemState>>({});
  const [evidence, setEvidence] = useState<PortalEvidenceFile[]>([]);
  // Set when the engine says the window closed (submitted elsewhere).
  const [closedMessage, setClosedMessage] = useState<string | null>(null);

  /**
   * Re-read attachments only. Called after an upload so a question's file list
   * and its `evidence_count` refresh without re-fetching (and re-initialising)
   * every answer — that would discard notes the vendor is part-way through
   * typing on another question.
   */
  const fetchEvidence = useCallback(async () => {
    try {
      const result = await portalFetch<{ files: PortalEvidenceFile[] }>("/evidence");
      if (result.status === 401) {
        onUnauthorized();
        return;
      }
      if (result.ok && result.body) {
        const files = result.body.files;
        setEvidence(files);
        // Keep the engine-decided counts in step with what we just read, so the
        // "evidence required" prompt clears the moment a file lands.
        setQuestions((prev) =>
          prev.map((q) => ({
            ...q,
            evidence_count: files.filter((f) => f.requirement_id === q.requirement_id).length,
          }))
        );
      }
    } catch {
      // A failed refresh leaves the previous list. The upload itself already
      // reported its own outcome; a second error here would be noise.
    }
  }, [onUnauthorized]);

  const fetchQuestions = useCallback(async () => {
    setLoad({ phase: "loading" });
    try {
      const [result, ev] = await Promise.all([
        portalFetch<{ questions: PortalQuestion[] }>("/questions"),
        portalFetch<{ files: PortalEvidenceFile[] }>("/evidence"),
      ]);
      if (result.status === 401 || ev.status === 401) {
        onUnauthorized();
        return;
      }
      if (!result.ok || !result.body) {
        setLoad({ phase: "error" });
        return;
      }
      setQuestions(result.body.questions);
      setItems(
        Object.fromEntries(result.body.questions.map((q) => [q.requirement_id, initialItemState(q)]))
      );
      // Attachments are supporting detail: if that read fails the questionnaire
      // is still answerable, so it must not take the whole page to `error`.
      if (ev.ok && ev.body) setEvidence(ev.body.files);
      setLoad({ phase: "ready" });
    } catch {
      setLoad({ phase: "error" });
    }
  }, [onUnauthorized]);

  useEffect(() => {
    void fetchQuestions();
  }, [fetchQuestions]);

  const readOnly = !engagement?.accepting_responses || closedMessage !== null;

  const patchItem = useCallback((id: string, patch: Partial<ItemState>) => {
    setItems((prev) => ({ ...prev, [id]: { ...prev[id]!, ...patch } }));
  }, []);

  /** Save one answer (+ notes). Optimistic: UI already shows `answer`. */
  const save = useCallback(
    async (id: string, answer: string, notes: string) => {
      patchItem(id, { saving: true, saved: false, error: null });
      try {
        const result = await portalFetch<{ ok: boolean }>(
          `/questions/${encodeURIComponent(id)}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ answer, notes: notes.length > 0 ? notes : null }),
          }
        );
        if (result.status === 401) {
          onUnauthorized();
          return;
        }
        if (result.status === 409) {
          // Submitted (possibly in another tab): rollback and lock everything.
          setItems((prev) => ({
            ...prev,
            [id]: {
              ...prev[id]!,
              answer: prev[id]!.savedAnswer,
              notes: prev[id]!.savedNotes,
              saving: false,
            },
          }));
          setClosedMessage(
            errorMessage(result, "This questionnaire is no longer accepting changes.")
          );
          void reloadEngagement();
          return;
        }
        if (!result.ok) {
          // Rollback to the last engine-confirmed state, surface the message.
          setItems((prev) => ({
            ...prev,
            [id]: {
              ...prev[id]!,
              answer: prev[id]!.savedAnswer,
              notes: prev[id]!.savedNotes,
              saving: false,
              error: errorMessage(result, "Could not save this answer. Please try again."),
            },
          }));
          return;
        }
        patchItem(id, {
          savedAnswer: answer,
          savedNotes: notes,
          saving: false,
          saved: true,
          error: null,
        });
      } catch {
        setItems((prev) => ({
          ...prev,
          [id]: {
            ...prev[id]!,
            answer: prev[id]!.savedAnswer,
            notes: prev[id]!.savedNotes,
            saving: false,
            error: "Network problem — your change was not saved. Please try again.",
          },
        }));
      }
    },
    [onUnauthorized, patchItem, reloadEngagement]
  );

  const groups = useMemo(() => {
    const required = questions.filter((q) => q.mandatory);
    const additional = questions.filter((q) => !q.mandatory);
    return [
      { key: "required", label: "Required questions", items: required },
      { key: "additional", label: "Additional questions", items: additional },
    ].filter((g) => g.items.length > 0);
  }, [questions]);

  if (load.phase === "loading") {
    return (
      <div className="rounded-xl border border-brand-line bg-brand-surface p-8 text-sm text-slate-400">
        Loading the questionnaire…
      </div>
    );
  }

  if (load.phase === "error") {
    return (
      <div className="rounded-xl border border-brand-line bg-brand-surface p-8">
        <p className="text-sm text-slate-300">We could not load the questionnaire.</p>
        <button
          type="button"
          onClick={() => void fetchQuestions()}
          className="mt-4 rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-brand-bg hover:opacity-90"
        >
          Try again
        </button>
      </div>
    );
  }

  if (questions.length === 0) {
    return (
      <div className="rounded-xl border border-brand-line bg-brand-surface p-8">
        <p className="text-sm leading-6 text-slate-300">
          No questions are in scope for this request yet. If you were expecting a
          questionnaire, please contact the organization that sent you the link.
        </p>
      </div>
    );
  }

  const answeredCount = Object.values(items).filter((s) => s.savedAnswer !== null).length;

  return (
    <div className="space-y-6">
      {(closedMessage || readOnly) && (
        <div className="rounded-xl border border-brand-line bg-brand-surface p-4 text-sm leading-6 text-slate-300">
          {closedMessage ??
            (engagement?.status === "clarification_requested"
              ? "The reviewer has asked for clarification. Answers are locked, but you can reply in Messages and add or withdraw attachments — updating your attachments reopens the questionnaire."
              : "This questionnaire has been submitted and is read-only. If anything needs to change, contact the reviewer through Messages.")}
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">
          {answeredCount} of {questions.length} answered
        </p>
        <Link href="/portal/review" className="text-sm font-medium text-brand-teal hover:underline">
          Review & submit →
        </Link>
      </div>

      {groups.map((group) => (
        <section key={group.key}>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
            {group.label}
          </h2>
          <ol className="space-y-4">
            {group.items.map((q) => {
              const s = items[q.requirement_id]!;
              const notesDirty = s.notes !== s.savedNotes;
              // Read against the answer showing RIGHT NOW (optimistic), so the
              // prompt appears on the click rather than one fetch later.
              const explanationNeeded = explanationRequiredForAnswer(s.answer, q.evidence_policy);
              const explanationMissing = explanationNeeded && s.notes.trim().length === 0;
              const questionFiles = evidence.filter((f) => f.requirement_id === q.requirement_id);
              return (
                <li
                  key={q.requirement_id}
                  className="rounded-xl border border-brand-line bg-brand-surface p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs text-slate-500">{q.reference}</span>
                        {q.mandatory && (
                          <span className="rounded-full border border-brand-teal/50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-teal">
                            Required
                          </span>
                        )}
                        <span className="rounded-full border border-brand-line px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">
                          {depthLabel(q.depth)}
                        </span>
                      </div>
                      <h3 className="mt-1.5 text-sm font-semibold leading-6 text-slate-100">
                        {q.title}
                      </h3>
                    </div>
                    <div className="text-xs text-slate-500">
                      {s.saving && <span>Saving…</span>}
                      {!s.saving && s.saved && <span className="text-brand-teal">Saved</span>}
                    </div>
                  </div>

                  {q.guidance && (
                    <p className="mt-2 text-sm leading-6 text-slate-400">{q.guidance}</p>
                  )}

                  <WhyWeAreAsking reasons={q.why_we_are_asking} />

                  {/* Answer selector */}
                  <fieldset className="mt-4" disabled={readOnly || s.saving}>
                    <legend className="sr-only">Answer for {q.reference}</legend>
                    <div className="flex flex-wrap gap-2">
                      {ANSWER_OPTIONS.map((opt) => {
                        const selected = s.answer === opt.value;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            title={opt.hint}
                            aria-pressed={selected}
                            disabled={readOnly || s.saving}
                            onClick={() => {
                              if (selected) return;
                              // Optimistic: show it immediately, then persist.
                              patchItem(q.requirement_id, {
                                answer: opt.value,
                                saved: false,
                                error: null,
                              });
                              void save(q.requirement_id, opt.value, s.notes);
                            }}
                            className={
                              "rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors " +
                              (selected
                                ? "border-brand-teal bg-brand-teal/15 text-brand-teal"
                                : "border-brand-line text-slate-300 hover:border-slate-500") +
                              (readOnly ? " cursor-not-allowed opacity-60" : "")
                            }
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>

                  {/* Explanation */}
                  <div className="mt-3">
                    <label
                      htmlFor={`notes-${q.requirement_id}`}
                      className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500"
                    >
                      Explanation {explanationNeeded ? "(required)" : "(optional)"}
                    </label>
                    <textarea
                      id={`notes-${q.requirement_id}`}
                      value={s.notes}
                      maxLength={4000}
                      rows={2}
                      disabled={readOnly}
                      aria-required={explanationNeeded}
                      onChange={(e) =>
                        patchItem(q.requirement_id, { notes: e.target.value, saved: false })
                      }
                      placeholder={
                        s.answer
                          ? (EXPLANATION_PROMPT[s.answer] ??
                            "Add context, compensating controls, or references to attachments.")
                          : "Add context, compensating controls, or references to attachments."
                      }
                      className={
                        "w-full rounded-lg border bg-brand-bg p-3 text-sm text-slate-100 placeholder:text-slate-600 focus:border-brand-teal focus:outline-none disabled:opacity-60 " +
                        (explanationMissing ? "border-amber-500/60" : "border-brand-line")
                      }
                    />
                    {/*
                      A prompt, not a block. The answer is already saved; the
                      vendor is told now so they are not surprised by the submit
                      refusal, and they may still leave it and come back.
                    */}
                    {explanationMissing && !readOnly && (
                      <p className="mt-1 text-xs leading-5 text-amber-300">
                        An explanation is required before this questionnaire can be submitted.
                      </p>
                    )}
                    {notesDirty && !readOnly && (
                      <div className="mt-2 flex items-center gap-3">
                        <button
                          type="button"
                          disabled={s.saving || s.answer === null}
                          onClick={() => void save(q.requirement_id, s.answer!, s.notes)}
                          className="rounded-lg bg-brand-teal px-3 py-1.5 text-xs font-semibold text-brand-bg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Save explanation
                        </button>
                        {s.answer === null && (
                          <span className="text-xs text-slate-500">
                            Choose an answer first — the explanation is saved with it.
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/*
                    `readOnly` here is the same predicate the engine reports as
                    `accepting_uploads` on /evidence — both are
                    isPortalRespondable — so attachments and answers open and
                    close together rather than through two separate gates.
                  */}
                  <QuestionEvidence
                    requirementId={q.requirement_id}
                    files={questionFiles}
                    readOnly={readOnly}
                    required={q.evidence_required === true}
                    onChanged={fetchEvidence}
                    onUnauthorized={onUnauthorized}
                  />

                  {s.error && (
                    <p className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs leading-5 text-red-300">
                      {s.error}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      ))}

      <div className="flex justify-end">
        <Link
          href="/portal/review"
          className="rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-brand-bg hover:opacity-90"
        >
          Review & submit
        </Link>
      </div>
    </div>
  );
}
