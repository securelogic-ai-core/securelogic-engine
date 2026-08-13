"use client";

/**
 * /portal — engagement overview.
 *
 * Orientation for the vendor's compliance contact: who is asking, what state
 * the request is in, how much is left to do, and where to go next. All data
 * comes from the shell's engagement read plus GET /questions for progress.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePortal } from "./PortalShell";
import {
  formatDate,
  portalFetch,
  statusLabel,
  type PortalQuestion,
} from "./portalApi";

type QuestionsState =
  | { phase: "loading" }
  | { phase: "error" }
  | { phase: "ready"; questions: PortalQuestion[] };

export default function PortalOverviewPage() {
  const { engagement, onUnauthorized } = usePortal();
  const [state, setState] = useState<QuestionsState>({ phase: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await portalFetch<{ questions: PortalQuestion[] }>("/questions");
        if (cancelled) return;
        if (result.status === 401) {
          onUnauthorized();
          return;
        }
        if (!result.ok || !result.body) {
          setState({ phase: "error" });
          return;
        }
        setState({ phase: "ready", questions: result.body.questions });
      } catch {
        if (!cancelled) setState({ phase: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onUnauthorized]);

  if (!engagement) return null;

  const submittedOrLater = !engagement.accepting_responses;
  const clarification = engagement.status === "clarification_requested";
  const dueDate = formatDate(engagement.due_date);

  const total = state.phase === "ready" ? state.questions.length : null;
  const answered =
    state.phase === "ready" ? state.questions.filter((q) => q.answer !== null).length : null;
  const mandatoryOutstanding =
    state.phase === "ready"
      ? state.questions.filter((q) => q.mandatory && q.answer === null).length
      : null;

  return (
    <div className="space-y-6">
      {/* What this is */}
      <section className="rounded-xl border border-brand-line bg-brand-surface p-6">
        <h2 className="text-base font-semibold text-slate-100">About this request</h2>
        <p className="mt-2 text-sm leading-6 text-slate-300">
          {engagement.organization_name} uses SecureLogic AI to run its vendor assurance
          programme. As part of its due diligence, it has asked{" "}
          {engagement.vendor_name} to answer a set of security and compliance questions
          scoped to the service you provide. Each question explains why it applies to you.
        </p>
        <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-brand-line bg-brand-bg p-3">
            <dt className="text-xs uppercase tracking-wide text-slate-500">Status</dt>
            <dd className="mt-1 text-sm font-medium text-slate-200">
              {statusLabel(engagement.status)}
            </dd>
          </div>
          <div className="rounded-lg border border-brand-line bg-brand-bg p-3">
            <dt className="text-xs uppercase tracking-wide text-slate-500">Progress</dt>
            <dd className="mt-1 text-sm font-medium text-slate-200">
              {state.phase === "loading" && "Loading…"}
              {state.phase === "error" && "Unavailable"}
              {state.phase === "ready" && `${answered} of ${total} answered`}
            </dd>
          </div>
          <div className="rounded-lg border border-brand-line bg-brand-bg p-3">
            <dt className="text-xs uppercase tracking-wide text-slate-500">Due</dt>
            <dd className="mt-1 text-sm font-medium text-slate-200">
              {dueDate ?? "No date set"}
            </dd>
          </div>
        </dl>
      </section>

      {/* State-specific guidance */}
      {clarification && (
        <section className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-5">
          <h2 className="text-sm font-semibold text-amber-300">Clarification requested</h2>
          <p className="mt-1 text-sm leading-6 text-amber-100/90">
            The reviewer has asked for clarification. Please read their message and respond —
            you can reply in{" "}
            <Link href="/portal/clarifications" className="underline">
              Messages
            </Link>{" "}
            and update your{" "}
            <Link href="/portal/evidence" className="underline">
              attachments
            </Link>
            .
          </p>
        </section>
      )}

      {submittedOrLater && !clarification && (
        <section className="rounded-xl border border-brand-line bg-brand-surface p-5">
          <h2 className="text-sm font-semibold text-slate-100">
            Your responses have been submitted
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-300">
            The questionnaire is now read-only while {engagement.organization_name} reviews
            your answers. If the reviewer has questions, they will contact you through the{" "}
            <Link href="/portal/clarifications" className="text-brand-teal hover:underline">
              Messages
            </Link>{" "}
            thread.
          </p>
        </section>
      )}

      {!submittedOrLater && state.phase === "ready" && mandatoryOutstanding !== null && (
        <section className="rounded-xl border border-brand-line bg-brand-surface p-5">
          <h2 className="text-sm font-semibold text-slate-100">What&apos;s left</h2>
          <p className="mt-1 text-sm leading-6 text-slate-300">
            {mandatoryOutstanding === 0
              ? "All required questions are answered. You can review and submit when ready."
              : `${mandatoryOutstanding} required question${
                  mandatoryOutstanding === 1 ? "" : "s"
                } still need${mandatoryOutstanding === 1 ? "s" : ""} an answer before you can submit.`}
          </p>
        </section>
      )}

      {/* Where to go */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Link
          href="/portal/questionnaire"
          className="rounded-xl border border-brand-line bg-brand-surface p-5 transition-colors hover:border-brand-teal/60"
        >
          <h3 className="text-sm font-semibold text-slate-100">Questionnaire</h3>
          <p className="mt-1 text-sm text-slate-400">
            Answer each control question, with notes where helpful.
          </p>
        </Link>
        <Link
          href="/portal/evidence"
          className="rounded-xl border border-brand-line bg-brand-surface p-5 transition-colors hover:border-brand-teal/60"
        >
          <h3 className="text-sm font-semibold text-slate-100">Attachments</h3>
          <p className="mt-1 text-sm text-slate-400">
            Attach supporting documents — reports, certificates, policies.
          </p>
        </Link>
        <Link
          href="/portal/clarifications"
          className="rounded-xl border border-brand-line bg-brand-surface p-5 transition-colors hover:border-brand-teal/60"
        >
          <h3 className="text-sm font-semibold text-slate-100">Messages</h3>
          <p className="mt-1 text-sm text-slate-400">
            Ask questions or respond to the reviewer&apos;s clarifications.
          </p>
        </Link>
        <Link
          href="/portal/review"
          className="rounded-xl border border-brand-line bg-brand-surface p-5 transition-colors hover:border-brand-teal/60"
        >
          <h3 className="text-sm font-semibold text-slate-100">Review & submit</h3>
          <p className="mt-1 text-sm text-slate-400">
            Check for anything outstanding, then submit your responses.
          </p>
        </Link>
      </section>
    </div>
  );
}
