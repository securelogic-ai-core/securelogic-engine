/**
 * factResolver.ts — from stored fact rows to the ONE typed surface the scope
 * resolver reads (VA-Q2 P1; VA-Q0 §4.3, §6.1; ADR-0013 R4).
 *
 * PURE. Three jobs:
 *
 *   1. `factsFromInherent(input)` — mirror the 13 inherent inputs as `core.*`
 *      rows with `source='intake', origin='intake'`. The 13 columns remain the
 *      store of record for inherent risk; this is the transitional mirror
 *      VA-Q0 §4.3 ratified (P3 persists the same rows through
 *      `factStore.mirrorInherentFacts`). `inherentFromFacts` is its inverse,
 *      so S2's predicates can keep reading an `InherentRiskInput` shape while
 *      sourcing it from the FactSet.
 *
 *   2. `resolveFacts(rows)` — one value per key by ORIGIN PRECEDENCE
 *      (`vendor_answer > intake > ai_system_dependency > vendor_profile >
 *      profile_default`; `derived` stands alone), with the WIDEN-ONLY rule:
 *      a `vendor_answer` never narrows what an internal origin declared. For a
 *      ranked fact the effective value is the higher of (vendor, best internal);
 *      for a bool, an internal `true` cannot be answered away; for a list, the
 *      vendor may add entries, never remove them; for an unordered enum the
 *      vendor cannot override an internal value at all.
 *
 *      Only `accepted` rows are read. A row carrying any other `status`
 *      (`proposed`, `superseded`, `rejected`) is invisible to every rule —
 *      which is how an `ai_extraction` row (born `proposed`) stays
 *      non-authoritative until the governed human accept flips it. A row from
 *      `ai_extraction` with NO status (an in-memory row nobody stored) is
 *      refused outright: the only accept path is the store's.
 *
 *   3. `resolveFacts(rows, { verifiedOnly: true })` — the REASSESSMENT view
 *      (ADR-0013 R4 clarification): every row whose SOURCE is not internal
 *      (`vendor_response`, `ai_extraction`) is dropped, so a fresh composition
 *      reads only verified facts and MAY be narrower. (Q0 §6.1: "internal-
 *      sourced or reviewer-confirmed — never a prior unconfirmed vendor answer
 *      alone"; `system_derived` mirrors of the platform's own canonical rows
 *      are internal by that definition.)
 *
 * Rows arrive subject-agnostic (D1 option B): the caller loads one subject's
 * rows; mixing subjects in one call is an error, not a merge.
 */

import type { InherentRiskInput } from "./inherentRisk.js";
import {
  AI_FACT_SOURCE,
  FACT_REGISTRY,
  factRank,
  isFactKey,
  isFactOrigin,
  isFactSource,
  isInternalOrigin,
  isInternalSource,
  outranks,
  validateFact,
  type FactKey,
  type FactOrigin,
  type FactRow,
  type FactSource,
  type FactValue,
} from "./factRegistry.js";

/** A resolved fact: the effective value, the origin that won (and its trust class), and every origin that spoke. */
export type ResolvedFact = {
  value: FactValue;
  /** The mechanism whose value won. */
  origin: FactOrigin;
  /** The trust class of the winning row. */
  source: FactSource;
  /** Every origin that supplied a valid, accepted row for the key, highest precedence first. */
  contributing_origins: readonly FactOrigin[];
};

export type FactSet = Readonly<Partial<Record<FactKey, ResolvedFact>>>;

export type ResolveFactsOptions = {
  /** Keep INTERNAL sources only (drop `vendor_response` and `ai_extraction`): the reassessment view (ADR-0013 R4). */
  verifiedOnly?: boolean;
};

// ── The 13-input mirror ─────────────────────────────────────────────────────

/** InherentRiskInput field → core.* key. A total, injective map — tested as a bijection. */
export const CORE_FACT_KEYS: Readonly<Record<keyof InherentRiskInput, FactKey>> = {
  data_sensitivity: "core.data_sensitivity",
  data_volume: "core.data_volume",
  access_level: "core.access_level",
  operational_dependency: "core.operational_dependency",
  recoverability: "core.recoverability",
  business_criticality: "core.business_criticality",
  regulatory_exposure: "core.regulatory_exposure",
  regulatory_breach_notification: "core.regulatory_breach_notification",
  ai_involvement: "core.ai_involvement",
  ai_autonomy: "core.ai_autonomy",
  hosting_model: "core.hosting_model",
  fourth_party_exposure: "core.fourth_party_exposure",
  concentration: "core.concentration",
};

const INHERENT_FIELDS = Object.keys(CORE_FACT_KEYS) as ReadonlyArray<keyof InherentRiskInput>;

/** The 13 inherent inputs as `core.*` intake rows (`source='intake'`, `origin='intake'`). Field order is fixed, so output is stable. */
export function factsFromInherent(input: InherentRiskInput): FactRow[] {
  return INHERENT_FIELDS.map((field) => ({
    fact_key: CORE_FACT_KEYS[field],
    value: input[field],
    source: "intake",
    origin: "intake",
  }));
}

/**
 * The inverse mirror: rebuild an `InherentRiskInput` from a FactSet so S2's
 * predicates read through facts. `fallback` fills any core key the set lacks
 * (a caller that passed only non-core facts still gets a complete shape).
 */
export function inherentFromFacts(facts: FactSet, fallback: InherentRiskInput): InherentRiskInput {
  const out = { ...fallback };
  for (const field of INHERENT_FIELDS) {
    const f = facts[CORE_FACT_KEYS[field]];
    if (f !== undefined) (out as Record<string, unknown>)[field] = f.value;
  }
  return out;
}

// ── Precedence + widen-only ─────────────────────────────────────────────────

function toTime(v: string | Date | undefined): number {
  if (v === undefined) return 0;
  const t = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isFinite(t) ? t : 0;
}

/** The widened value of a vendor answer against the best internal value (ADR-0013 R4). */
function widen(key: FactKey, vendor: FactValue, internal: FactValue | undefined): FactValue {
  if (internal === undefined) return vendor;
  const spec = FACT_REGISTRY[key];
  switch (spec.type) {
    case "bool":
      // `true` activates; an internal `true` cannot be answered away.
      return internal === true ? true : vendor;
    case "ranked":
      return factRank(key, vendor) >= factRank(key, internal) ? vendor : internal;
    case "enum[]":
    case "string[]": {
      const merged = [...(internal as readonly string[])];
      for (const v of vendor as readonly string[]) if (!merged.includes(v)) merged.push(v);
      return merged;
    }
    case "enum":
      // No order — a vendor cannot override an internal declaration.
      return internal;
  }
}

/**
 * Resolve one subject's rows. Invalid rows (unregistered key, bad value,
 * disallowed source/origin/pair) are SKIPPED, never coerced — the store's
 * writer already refused them, and a rule must not fire on garbage. Rows that
 * are not `accepted` are skipped. Mixed subjects throw.
 */
export function resolveFacts(rows: readonly FactRow[], opts: ResolveFactsOptions = {}): FactSet {
  let subjectSeen: string | null = null;
  const byKey = new Map<FactKey, Array<{ source: FactSource; origin: FactOrigin; value: FactValue; at: number }>>();

  for (const row of rows) {
    if (row.subject) {
      const sig = `${row.subject.subject_type}:${row.subject.subject_id}`;
      if (subjectSeen !== null && subjectSeen !== sig) {
        throw new Error(`resolveFacts: rows span more than one subject (${subjectSeen}, ${sig})`);
      }
      subjectSeen = sig;
    }
    if (!isFactKey(row.fact_key) || !isFactSource(row.source) || !isFactOrigin(row.origin)) continue;
    // Status: only `accepted` is a fact. An AI row must have BEEN accepted (by
    // the store) — an in-memory ai_extraction row with no status is refused.
    if (row.status !== undefined && row.status !== "accepted") continue;
    if (row.source === AI_FACT_SOURCE && row.status !== "accepted") continue;
    if (opts.verifiedOnly && !isInternalSource(row.source)) continue;
    const v = validateFact(row.fact_key, row.value, row.source, row.origin);
    if (!v.ok) continue;
    const list = byKey.get(v.key) ?? [];
    list.push({ source: v.source, origin: v.origin, value: v.value, at: toTime(row.observed_at) });
    byKey.set(v.key, list);
  }

  const out: Partial<Record<FactKey, ResolvedFact>> = {};
  for (const [key, list] of byKey) {
    // Most recent wins within an origin; then precedence over origins.
    list.sort((a, b) => {
      if (a.origin === b.origin) return b.at - a.at;
      if (a.origin === "derived") return 1;
      if (b.origin === "derived") return -1;
      return outranks(a.origin, b.origin) ? -1 : 1;
    });
    const contributing: FactOrigin[] = [];
    for (const e of list) if (!contributing.includes(e.origin)) contributing.push(e.origin);

    const winner = list[0]!;
    if (winner.origin !== "vendor_answer") {
      out[key] = { value: winner.value, origin: winner.origin, source: winner.source, contributing_origins: contributing };
      continue;
    }
    // Widen-only: the vendor's (most recent) answer may only widen the best internal value.
    const internal = list.find((e) => isInternalOrigin(e.origin));
    const value = widen(key, winner.value, internal?.value);
    const internalWon = internal !== undefined && value === internal.value && value !== winner.value;
    out[key] = internalWon
      ? { value, origin: internal.origin, source: internal.source, contributing_origins: contributing }
      : { value, origin: "vendor_answer", source: winner.source, contributing_origins: contributing };
  }
  return out;
}

// ── Typed readers for rules ─────────────────────────────────────────────────

export function factBool(facts: FactSet, key: FactKey): boolean | undefined {
  const f = facts[key];
  return f && typeof f.value === "boolean" ? f.value : undefined;
}

export function factString(facts: FactSet, key: FactKey): string | undefined {
  const f = facts[key];
  return f && typeof f.value === "string" ? f.value : undefined;
}

export function factList(facts: FactSet, key: FactKey): readonly string[] {
  const f = facts[key];
  return f && Array.isArray(f.value) ? (f.value as readonly string[]) : [];
}

/** True when the ranked fact is at or above `threshold`. Absent → false (never activates on silence). */
export function factAtLeast(facts: FactSet, key: FactKey, threshold: string): boolean {
  const f = facts[key];
  if (!f) return false;
  const r = factRank(key, f.value);
  const t = factRank(key, threshold);
  return r >= 0 && t >= 0 && r >= t;
}

/** True when any accepted row for the key came via `origin` (regardless of which origin won). */
export function factAssertedBy(facts: FactSet, key: FactKey, origin: FactOrigin): boolean {
  return facts[key]?.contributing_origins.includes(origin) ?? false;
}
