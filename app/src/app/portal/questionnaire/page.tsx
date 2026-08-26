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
  depthLabel,
  errorMessage,
  portalFetch,
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
  /**
   * VA-P1. The engine's `updated_at` for this answer as of the last time we saw
   * it, sent back on save so a colleague's newer edit is not silently replaced.
   * Null when nobody has answered yet — there is nothing to lose.
   */
  answeredAt: string | null;
  answeredByName: string | null;
  answeredByYou: boolean;
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
    answeredAt: q.answered_at,
    answeredByName: q.answered_by_name,
    answeredByYou: q.answered_by_you,
  };
}

function WhyWeAreAsking({ reasons }: { reasons: ScopeReason[] | null }) {
  if (!reasons || reasons.length === 0) return null;
  return (
    <details className="mt-3 rounded-lg border border-brand-line bg-brand-bg p-3">
      <summary className="cursor-pointer text-xs font-medium text-slate-400 hover:text-slate-200">
        Why we&apos;re asking
      </summary>
      <ul className="mt-2 space-y-1.5">
        {reasons.map((r, i) => (
          <li key={`${r.rule_id}-${i}`} className="text-xs leading-5 text-slate-300">
            <span className="mr-2 inline-block rounded border border-brand-line px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
              {r.rule_id}
            </span>
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
  // VA-P1: `save` is memoized and must not re-create on every keystroke, so the
  // per-answer concurrency token is read through a ref rather than closed over.
  const itemsRef = useRef<Record<string, ItemState>>({});
  const [items, setItems] = useState<Record<string, ItemState>>({});
  // Set when the engine says the window closed (submitted elsewhere).
  const [closedMessage, setClosedMessage] = useState<string | null>(null);

  const fetchQuestions = useCallback(async () => {
    setLoad({ phase: "loading" });
    try {
      const result = await portalFetch<{ questions: PortalQuestion[] }>("/questions");
      if (result.status === 401) {
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
      setLoad({ phase: "ready" });
    } catch {
      setLoad({ phase: "error" });
    }
  }, [onUnauthorized]);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

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
        const result = await portalFetch<{ ok: boolean; answered_at: string | null }>(
          `/questions/${encodeURIComponent(id)}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            // VA-P1: the lost-update guard. Echoing back what we rendered lets
            // the engine refuse a save that would overwrite a teammate's newer
            // answer, instead of last-write-wins across colleagues.
            body: JSON.stringify({
              answer,
              notes: notes.length > 0 ? notes : null,
              prev_answered_at: itemsRef.current[id]?.answeredAt ?? undefined,
            }),
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
        if (result.status === 412) {
          // A colleague changed this answer while it was open here. Roll back to
          // what they wrote and say whose it is — never silently keep the local
          // edit, which is the whole failure this guard exists to prevent.
          const message = errorMessage(
            result,
            "This answer changed while you were working on it. Reload to see the current version."
          );
          setItems((prev) => ({
            ...prev,
            [id]: {
              ...prev[id]!,
              answer: prev[id]!.savedAnswer,
              notes: prev[id]!.savedNotes,
              saving: false,
              error: message,
            },
          }));
          void fetchQuestions();
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
          // Advance the token to the value this save produced, so the next edit
          // is not refused because of the previous one.
          answeredAt: result.body?.answered_at ?? null,
          answeredByName: null,
          answeredByYou: true,
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
                    <div className="text-right text-xs text-slate-500">
                      {s.saving && <span>Saving…</span>}
                      {!s.saving && s.saved && <span className="text-brand-teal">Saved</span>}
                      {/* VA-P1: whose answer this is. Only shown for a
                          COLLEAGUE's — labelling your own work by name is
                          noise, and the point is to know before you change
                          something somebody else wrote. */}
                      {!s.saving && !s.saved && s.answeredByName && !s.answeredByYou && (
                        <span className="block text-slate-400">
                          Answered by {s.answeredByName}
                        </span>
                      )}
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

                  {/* Notes */}
                  <div className="mt-3">
                    <label
                      htmlFor={`notes-${q.requirement_id}`}
                      className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500"
                    >
                      Notes (optional)
                    </label>
                    <textarea
                      id={`notes-${q.requirement_id}`}
                      value={s.notes}
                      maxLength={4000}
                      rows={2}
                      disabled={readOnly}
                      onChange={(e) =>
                        patchItem(q.requirement_id, { notes: e.target.value, saved: false })
                      }
                      placeholder="Add context, compensating controls, or references to attachments."
                      className="w-full rounded-lg border border-brand-line bg-brand-bg p-3 text-sm text-slate-100 placeholder:text-slate-600 focus:border-brand-teal focus:outline-none disabled:opacity-60"
                    />
                    {notesDirty && !readOnly && (
                      <div className="mt-2 flex items-center gap-3">
                        <button
                          type="button"
                          disabled={s.saving || s.answer === null}
                          onClick={() => void save(q.requirement_id, s.answer!, s.notes)}
                          className="rounded-lg bg-brand-teal px-3 py-1.5 text-xs font-semibold text-brand-bg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Save notes
                        </button>
                        {s.answer === null && (
                          <span className="text-xs text-slate-500">
                            Choose an answer first — notes are saved with it.
                          </span>
                        )}
                      </div>
                    )}
                  </div>

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
