"use client";

/**
 * /portal/review — pre-submit review.
 *
 * Calls out every unanswered REQUIRED question (the engine refuses submission
 * with 422 `incomplete` while any remain), summarizes progress, and submits
 * via POST /submit. After submission the questionnaire becomes read-only
 * evidence — the confirmation copy says so before the vendor commits.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePortal } from "../PortalShell";
import {
  answerLabel,
  errorMessage,
  portalFetch,
  questionBlocker,
  type IncompleteReason,
  type PortalQuestion,
} from "../portalApi";

type LoadState = "loading" | "error" | "ready";

export default function ReviewPage() {
  const router = useRouter();
  const { engagement, onUnauthorized, reloadEngagement } = usePortal();
  const [load, setLoad] = useState<LoadState>("loading");
  const [questions, setQuestions] = useState<PortalQuestion[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await portalFetch<{ questions: PortalQuestion[] }>("/questions");
      if (result.status === 401) {
        onUnauthorized();
        return;
      }
      if (!result.ok || !result.body) {
        setLoad("error");
        return;
      }
      setQuestions(result.body.questions);
      setLoad("ready");
    } catch {
      setLoad("error");
    }
  }, [onUnauthorized]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleSubmit() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await portalFetch<{ ok: boolean; status: string }>("/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (result.status === 401) {
        onUnauthorized();
        return;
      }
      if (result.ok) {
        await reloadEngagement();
        router.push("/portal/done");
        return;
      }
      // 422 incomplete / 409 cannot_submit — the engine's message names the
      // blocking condition (e.g. "3 required question(s) still need an answer").
      setSubmitError(errorMessage(result, "Your responses could not be submitted."));
      await refresh();
    } catch {
      setSubmitError("Network problem — nothing was submitted. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (load === "loading") {
    return (
      <div className="rounded-xl border border-brand-line bg-brand-surface p-8 text-sm text-slate-400">
        Checking your responses…
      </div>
    );
  }

  if (load === "error") {
    return (
      <div className="rounded-xl border border-brand-line bg-brand-surface p-8">
        <p className="text-sm text-slate-300">We could not load your responses for review.</p>
        <button
          type="button"
          onClick={() => void refresh()}
          className="mt-4 rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-brand-bg hover:opacity-90"
        >
          Try again
        </button>
      </div>
    );
  }

  // Already submitted (or later): review has nothing to submit.
  if (engagement && !engagement.accepting_responses) {
    return (
      <div className="rounded-xl border border-brand-line bg-brand-surface p-8">
        <h2 className="text-base font-semibold text-slate-100">Already submitted</h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          Your responses have been submitted and are with the reviewer. If they need
          anything further, they will contact you through{" "}
          <Link href="/portal/clarifications" className="text-brand-teal hover:underline">
            Messages
          </Link>
          .
        </p>
      </div>
    );
  }

  const answered = questions.filter((q) => q.answer !== null);

  // WA-1: the review screen now lists EVERY blocker the engine's submit gate
  // would refuse on, not just unanswered required questions. `questionBlocker`
  // reads the same two engine-decided flags the gate uses
  // (responseCompleteness.ts), so this list and the 422 cannot disagree.
  const blocked = questions
    .map((q) => ({ q, reason: questionBlocker(q) }))
    .filter((b): b is { q: PortalQuestion; reason: IncompleteReason } => b.reason !== null);
  const ready = blocked.length === 0;

  const BLOCKER_COPY: Record<IncompleteReason, string> = {
    unanswered: "Needs an answer",
    explanation_missing: "Needs an explanation",
    evidence_missing: "Needs supporting evidence",
  };
  const blockerCounts = {
    unanswered: blocked.filter((b) => b.reason === "unanswered").length,
    explanation_missing: blocked.filter((b) => b.reason === "explanation_missing").length,
    evidence_missing: blocked.filter((b) => b.reason === "evidence_missing").length,
  };
  const headline = [
    blockerCounts.unanswered > 0
      ? `${blockerCounts.unanswered} unanswered required question${blockerCounts.unanswered === 1 ? "" : "s"}`
      : null,
    blockerCounts.explanation_missing > 0
      ? `${blockerCounts.explanation_missing} answer${blockerCounts.explanation_missing === 1 ? "" : "s"} without an explanation`
      : null,
    blockerCounts.evidence_missing > 0
      ? `${blockerCounts.evidence_missing} answer${blockerCounts.evidence_missing === 1 ? "" : "s"} without required evidence`
      : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-brand-line bg-brand-surface p-6">
        <h2 className="text-base font-semibold text-slate-100">Review before you submit</h2>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          {answered.length} of {questions.length} questions answered. Once you submit, your
          answers become the formal record of this assessment and can no longer be changed
          in this portal.
        </p>
      </section>

      {/* Blocking items */}
      {blocked.length > 0 ? (
        <section className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-5">
          <h3 className="text-sm font-semibold text-amber-300">{headline}</h3>
          <p className="mt-1 text-sm leading-6 text-amber-100/90">
            These must be completed before you can submit. &ldquo;Partially in place&rdquo;,
            &ldquo;Not in place&rdquo; and &ldquo;Not applicable&rdquo; each need a short
            explanation so the reviewer can act on your answer.
          </p>
          <ul className="mt-3 space-y-2">
            {blocked.map(({ q, reason }) => (
              <li key={q.requirement_id} className="text-sm leading-6 text-amber-100/90">
                <span className="mr-2 font-mono text-xs text-amber-300/80">{q.reference}</span>
                {q.title}
                <span className="ml-2 rounded-full border border-amber-400/40 px-2 py-0.5 text-xs text-amber-200">
                  {BLOCKER_COPY[reason]}
                </span>
              </li>
            ))}
          </ul>
          <Link
            href="/portal/questionnaire"
            className="mt-4 inline-block rounded-lg bg-brand-teal px-4 py-2 text-sm font-semibold text-brand-bg hover:opacity-90"
          >
            Go to the questionnaire
          </Link>
        </section>
      ) : (
        <section className="rounded-xl border border-brand-teal/40 bg-brand-teal/10 p-5">
          <h3 className="text-sm font-semibold text-brand-teal">
            Everything required is complete
          </h3>
          <p className="mt-1 text-sm leading-6 text-slate-300">
            You can still go back and adjust anything before submitting.
          </p>
        </section>
      )}

      {/* Answer summary */}
      {answered.length > 0 && (
        <section>
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
            Your answers
          </h3>
          <ul className="divide-y divide-brand-line overflow-hidden rounded-xl border border-brand-line bg-brand-surface">
            {answered.map((q) => (
              <li key={q.requirement_id} className="flex items-start justify-between gap-4 p-4">
                <div className="min-w-0">
                  <span className="mr-2 font-mono text-xs text-slate-500">{q.reference}</span>
                  <span className="text-sm text-slate-200">{q.title}</span>
                </div>
                <span className="shrink-0 rounded-full border border-brand-line px-2 py-0.5 text-xs font-medium text-slate-300">
                  {answerLabel(q.answer)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {submitError && (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm leading-6 text-red-300">
          {submitError}
        </p>
      )}

      <div className="flex items-center justify-end gap-3">
        <Link href="/portal/questionnaire" className="text-sm font-medium text-slate-400 hover:text-slate-200">
          Back to questionnaire
        </Link>
        <button
          type="button"
          disabled={!ready || submitting}
          onClick={() => void handleSubmit()}
          className="rounded-lg bg-brand-teal px-5 py-2.5 text-sm font-semibold text-brand-bg hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Submitting…" : "Submit responses"}
        </button>
      </div>
    </div>
  );
}
