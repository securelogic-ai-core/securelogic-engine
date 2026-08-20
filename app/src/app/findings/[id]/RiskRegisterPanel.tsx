"use client";

/**
 * RiskRegisterPanel.tsx — where a finding meets the Risk Register.
 *
 * THE DEFAULT STATE IS "NOT ON THE REGISTER", and it is shown as a decision
 * that has not been taken rather than as missing data. Most findings should
 * stay standalone; a product that nagged about every one of them would teach
 * people to promote everything, and a register that contains everything ranks
 * nothing.
 *
 * Two acts, kept visibly distinct because they mean different things to an
 * auditor: LINK attaches this finding as evidence for a risk the organization
 * has already accepted into its register; PROMOTE asserts a new risk exists.
 *
 * Promotion asks for the ratings rather than proposing them. The engine defaults
 * only the clerical fields. A rating this panel invented would be a rating with
 * no author, and the register's whole value is that someone stands behind each
 * entry.
 */

import { useState, useTransition } from "react";
import Link from "next/link";

import {
  linkFindingToRisk,
  unlinkFindingFromRisk,
  promoteFindingToRisk,
} from "./riskLinkActions";
import type { FindingRiskLink } from "@/lib/api";

const LIKELIHOODS = ["very_likely", "likely", "possible", "unlikely", "rare"];
const INHERENT_LIKELIHOODS = LIKELIHOODS;
const SEVERITIES = ["Critical", "High", "Moderate", "Low"];

export interface RiskOption {
  id: string;
  title: string;
  risk_rating: string;
}

export function RiskRegisterPanel({
  findingId,
  links,
  availableRisks,
  canDecide,
}: {
  findingId: string;
  links: FindingRiskLink[];
  availableRisks: RiskOption[];
  canDecide: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"idle" | "link" | "promote">("idle");
  const [riskId, setRiskId] = useState("");
  const [note, setNote] = useState("");
  const [rating, setRating] = useState({
    likelihood: "likely", impact: "High", risk_rating: "High",
    inherent_likelihood: "likely", inherent_impact: "High", inherent_rating: "High",
    residual_likelihood: "possible", residual_impact: "Moderate", residual_rating: "Moderate",
  });

  const run = (fn: () => Promise<{ error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.error) setError(result.error);
      else { setMode("idle"); setRiskId(""); setNote(""); }
    });
  };

  const unlinked = availableRisks.filter((r) => !links.some((l) => l.risk_id === r.id));

  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
            Risk Register
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            {links.length === 0
              ? "This finding is standalone. Most findings should stay that way."
              : `Supporting ${links.length} register ${links.length === 1 ? "entry" : "entries"}.`}
          </p>
        </div>
        {canDecide && mode === "idle" && (
          <div className="flex gap-2 flex-shrink-0">
            {unlinked.length > 0 && (
              <button
                type="button"
                onClick={() => setMode("link")}
                className="text-sm font-medium text-slate-700 border border-slate-300 hover:border-slate-400 px-3 py-1.5 rounded-lg transition-colors"
              >
                Link to a risk
              </button>
            )}
            <button
              type="button"
              onClick={() => setMode("promote")}
              className="text-sm font-semibold text-white bg-teal-600 hover:bg-teal-500 px-3 py-1.5 rounded-lg transition-colors"
            >
              Add to register
            </button>
          </div>
        )}
      </div>

      {error && <p className="mb-3 text-sm text-red-700">{error}</p>}

      {links.length > 0 && (
        <ul className="space-y-2 mb-4">
          {links.map((l) => (
            <li
              key={l.risk_id}
              className="flex items-start justify-between gap-3 border border-slate-200 rounded-lg px-3 py-2"
            >
              <div className="min-w-0">
                <Link href={`/risks/${l.risk_id}`} className="text-sm font-medium text-teal-700 hover:underline">
                  {l.risk_title}
                </Link>
                <p className="text-xs text-slate-500 mt-0.5">
                  {l.risk_rating} · {l.risk_domain} · {l.risk_status}
                  {l.link_type === "promoted" && " · promoted from this finding"}
                </p>
                {l.note && <p className="text-xs text-slate-600 mt-1 italic">{l.note}</p>}
              </div>
              {canDecide && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => unlinkFindingFromRisk(findingId, l.risk_id))}
                  className="text-xs text-slate-500 hover:text-red-700 flex-shrink-0 disabled:opacity-50"
                >
                  {/* Unlink, never delete: both objects outlive the relationship. */}
                  Unlink
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {mode === "link" && (
        <div className="border-t border-slate-200 pt-4 space-y-3">
          <label className="block text-xs font-medium text-slate-600">
            Existing register entry
            <select
              value={riskId}
              onChange={(e) => setRiskId(e.target.value)}
              className="mt-1 block w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">Choose a risk…</option>
              {unlinked.map((r) => (
                <option key={r.id} value={r.id}>{r.title} ({r.risk_rating})</option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-medium text-slate-600">
            Why this finding evidences that risk (optional)
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="mt-1 block w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending || !riskId}
              onClick={() => run(() => linkFindingToRisk(findingId, riskId, note || undefined))}
              className="text-sm font-semibold text-white bg-teal-600 hover:bg-teal-500 px-4 py-1.5 rounded-lg disabled:opacity-50"
            >
              Link
            </button>
            <button type="button" onClick={() => setMode("idle")} className="text-sm text-slate-500 px-2">
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === "promote" && (
        <div className="border-t border-slate-200 pt-4 space-y-3">
          <p className="text-xs text-slate-500">
            This creates a new Risk Register entry from this finding. Title and domain
            carry over; you rate it.
          </p>
          {([
            ["Inherent (before controls)", "inherent_likelihood", "inherent_impact", "inherent_rating", INHERENT_LIKELIHOODS],
            ["Current", "likelihood", "impact", "risk_rating", LIKELIHOODS],
            ["Residual (after controls)", "residual_likelihood", "residual_impact", "residual_rating", LIKELIHOODS],
          ] as const).map(([label, lk, im, rt, options]) => (
            <div key={label}>
              <p className="text-xs font-medium text-slate-600 mb-1">{label}</p>
              <div className="grid grid-cols-3 gap-2">
                <select
                  aria-label={`${label} likelihood`}
                  value={rating[lk]}
                  onChange={(e) => setRating({ ...rating, [lk]: e.target.value })}
                  className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
                >
                  {options.map((o) => <option key={o} value={o}>{o.replace(/_/g, " ")}</option>)}
                </select>
                <select
                  aria-label={`${label} impact`}
                  value={rating[im]}
                  onChange={(e) => setRating({ ...rating, [im]: e.target.value })}
                  className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
                >
                  {SEVERITIES.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
                <select
                  aria-label={`${label} rating`}
                  value={rating[rt]}
                  onChange={(e) => setRating({ ...rating, [rt]: e.target.value })}
                  className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm"
                >
                  {SEVERITIES.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
            </div>
          ))}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => promoteFindingToRisk(findingId, { ...rating, ...(note ? { note } : {}) }))}
              className="text-sm font-semibold text-white bg-teal-600 hover:bg-teal-500 px-4 py-1.5 rounded-lg disabled:opacity-50"
            >
              {/* Named differently from the button that OPENED this form. The
                  first is "I want to consider this"; this one commits a new
                  entry to the register, and the two should never be one word. */}
              Create register entry
            </button>
            <button type="button" onClick={() => setMode("idle")} className="text-sm text-slate-500 px-2">
              Cancel
            </button>
          </div>
        </div>
      )}

      {!canDecide && links.length === 0 && (
        <p className="text-xs text-slate-400">
          Only analysts and admins can put a finding on the Risk Register.
        </p>
      )}
    </section>
  );
}
