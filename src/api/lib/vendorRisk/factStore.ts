/**
 * factStore.ts — the ONLY writer and reader of `assessment_facts`
 * (VA-Q2 P3; migration 20261063; owner decision D1 = Option B).
 *
 * Every function takes a `Queryable` that is ALREADY inside the caller's tenant
 * scope (`asTenant` / `withTenant`), the caller's `organizationId`, and a
 * `ResolvedFactSubject` obtained from `factSubjects.ts` — there is no entry
 * point that accepts a raw `subject_id`. Every statement carries
 * `organization_id`; RLS and the subject trigger re-check underneath.
 *
 * ── Writes are immutable history ─────────────────────────────────────────
 *
 * `writeFacts` never UPDATEs a value. For each (subject, fact_key, source,
 * origin) it reads the current `accepted` row; an identical `value_hash` is a
 * no-op (idempotent — the row count does not move); a different value flips
 * the old row to `superseded` and inserts the new `accepted` row with
 * `supersedes_id` → old, in the caller's transaction. Writers to one subject
 * are serialised by a transaction-scoped advisory lock, so two concurrent
 * identical PUTs also produce exactly one row.
 *
 * ── Q2 writes INTERNAL sources only ──────────────────────────────────────
 *
 * `Q2_WRITABLE_SOURCES` = intake · internal_user · system_derived. There is
 * no `vendor_response` writer (Q3) and no `ai_extraction` writer (Q6) in this
 * package — grep-asserted by the isolation suite. `verified_at` is set here
 * only for `intake` / `internal_user` (internal intake IS verification); a
 * `system_derived` mirror is a default, not a verification, and stays NULL.
 *
 * ── Mirrors (deterministic, idempotent, run at every scope resolve while mutable)
 *
 *   mirrorInherentFacts       13 columns → core.* (intake / intake)
 *   mirrorVendorProfileFacts  vendors.template_metadata.flags → data.personal_data,
 *                             ai.uses_ai (system_derived / vendor_profile);
 *                             absent flags write NOTHING — never `false` from silence
 *   mirrorAiDependencyFacts   ai_system_vendor_dependencies (active, this
 *                             engagement's vendor, same org) → ai.uses_ai,
 *                             ai.third_party_models (system_derived / ai_system_dependency)
 *                             — `training_data` does NOT infer ai.trains_on_customer_data
 *
 * Fact VALUES never reach logs or audit payloads from here (T-13): the
 * result carries keys and counts only.
 */

import { createHash } from "node:crypto";

import type { InherentRiskInput } from "./inherentRisk.js";
import {
  INTERNAL_FACT_SOURCES,
  VERIFYING_FACT_SOURCES,
  validateFact,
  type FactOrigin,
  type FactRow,
  type FactSource,
  type FactStatus,
  type FactValidationError,
} from "./factRegistry.js";
import { CORE_FACT_KEYS } from "./factResolver.js";
import { subjectRef, type Queryable, type ResolvedFactSubject } from "./factSubjects.js";

// ── Canonical value hash ────────────────────────────────────────────────────

/** RFC 8785-style canonical JSON: object keys sorted recursively, no whitespace. Stable across key order. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

export function factValueHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

// ── Types ───────────────────────────────────────────────────────────────────

export type FactProvenance = {
  actor: { kind: "user" | "system" | "vendor_participant" | "model"; id: string | null };
  /** route | job | worker name. */
  via: string;
  /** ISO-8601. */
  at: string;
  evidence?: { table: string; id: string } | null;
  model?: { model_id: string; prompt_version: string; input_hash: string } | null;
};

export type FactWrite = {
  fact_key: string;
  value: unknown;
  source: FactSource;
  origin: FactOrigin;
  observed_at: Date;
  provenance: FactProvenance;
  /** Defaults to 1. */
  confidence?: number;
  created_by?: string | null;
};

/** A row as stored — the `FactRow` the resolver reads, plus the store's columns. */
export type StoredFactRow = FactRow & {
  id: string;
  source: FactSource;
  origin: FactOrigin;
  status: FactStatus;
  provenance: FactProvenance;
  observed_at: Date;
  verified_at: Date | null;
  confidence: number;
  supersedes_id: string | null;
  accepted_at: Date | null;
  created_at: Date;
};

export type WriteFactsResult = {
  inserted: number;
  unchanged: number;
  superseded: number;
  /** Keys touched (written or confirmed) — never values. */
  keys: string[];
};

/** The sources any Q2 writer may emit. vendor_response = Q3; ai_extraction = Q6. */
export const Q2_WRITABLE_SOURCES: readonly FactSource[] = INTERNAL_FACT_SOURCES;

export class FactStoreValidationError extends Error {
  constructor(public readonly index: number, public readonly errors: FactValidationError[]) {
    super(`assessment_facts: invalid fact at index ${index}: ${errors.map((e) => `${e.field}: ${e.reason}`).join("; ")}`);
    this.name = "FactStoreValidationError";
  }
}

// ── Writer ──────────────────────────────────────────────────────────────────

const SELECT_COLUMNS = `id, organization_id, subject_type, subject_id, fact_key, value, value_hash,
       source, origin, provenance, observed_at, verified_at, confidence::float8 AS confidence,
       status, supersedes_id, accepted_at, accepted_by_user_id, created_by, created_at, updated_at`;

async function lockSubject(q: Queryable, subject: ResolvedFactSubject): Promise<void> {
  await q.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`assessment_facts:${subject.kind}:${subject.id}`]);
}

/**
 * Write a batch of facts about ONE subject. Each write is validated against the
 * registry (again — the route already did; the store is the last gate), then
 * de-duplicated against the current accepted row. Throws
 * `FactStoreValidationError` on the first invalid write (nothing is written:
 * the caller's transaction rolls back).
 */
export async function writeFacts(
  q: Queryable,
  organizationId: string,
  subject: ResolvedFactSubject,
  writes: readonly FactWrite[]
): Promise<WriteFactsResult> {
  if (subject.organization_id !== organizationId) {
    throw new Error("assessment_facts: subject does not belong to the caller's organization");
  }
  const ref = subjectRef(subject);
  const result: WriteFactsResult = { inserted: 0, unchanged: 0, superseded: 0, keys: [] };
  if (writes.length === 0) return result;

  // Validate everything before touching the table, so a bad batch writes nothing.
  const validated = writes.map((w, i) => {
    const v = validateFact(w.fact_key, w.value, w.source, w.origin, ref.subject_type);
    if (!v.ok) throw new FactStoreValidationError(i, v.errors);
    if (!Q2_WRITABLE_SOURCES.includes(v.source)) {
      throw new FactStoreValidationError(i, [{ field: "source", reason: `${v.source} has no writer in this package` }]);
    }
    if (!(w.observed_at instanceof Date) || Number.isNaN(w.observed_at.getTime()) || w.observed_at.getTime() > Date.now() + 5_000) {
      throw new FactStoreValidationError(i, [{ field: "value", reason: "observed_at must be a timestamp not in the future" }]);
    }
    return { ...w, key: v.key, value: v.value, source: v.source, origin: v.origin };
  });

  await lockSubject(q, subject);

  for (const w of validated) {
    const hash = factValueHash(w.value);
    const current = await q.query<{ id: string; value_hash: string }>(
      `SELECT id, value_hash FROM assessment_facts
        WHERE organization_id = $1 AND subject_type = $2 AND subject_id = $3
          AND fact_key = $4 AND source = $5 AND origin = $6 AND status = 'accepted'
        LIMIT 1`,
      [organizationId, ref.subject_type, ref.subject_id, w.key, w.source, w.origin]
    );
    const prior = current.rows[0];
    if (!result.keys.includes(w.key)) result.keys.push(w.key);
    if (prior && prior.value_hash === hash) {
      result.unchanged += 1;
      continue;
    }
    if (prior) {
      await q.query(
        `UPDATE assessment_facts SET status = 'superseded' WHERE id = $1 AND organization_id = $2 AND status = 'accepted'`,
        [prior.id, organizationId]
      );
      result.superseded += 1;
    }
    const verifiedAt = VERIFYING_FACT_SOURCES.includes(w.source) ? w.observed_at : null;
    await q.query(
      `INSERT INTO assessment_facts
         (organization_id, subject_type, subject_id, fact_key, value, value_hash, source, origin,
          provenance, observed_at, verified_at, confidence, status, supersedes_id, created_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9::jsonb, $10, $11, $12, 'accepted', $13, $14)`,
      [
        organizationId,
        ref.subject_type,
        ref.subject_id,
        w.key,
        JSON.stringify(w.value),
        hash,
        w.source,
        w.origin,
        JSON.stringify(w.provenance),
        w.observed_at,
        verifiedAt,
        w.confidence ?? 1,
        prior?.id ?? null,
        w.created_by ?? null,
      ]
    );
    result.inserted += 1;
  }
  return result;
}

// ── Reader ──────────────────────────────────────────────────────────────────

/**
 * Every row of ONE subject (all statuses — history included), oldest first.
 * The resolver ignores non-accepted rows itself; `GET /facts` shows them.
 */
export async function loadFactRows(
  q: Queryable,
  organizationId: string,
  subject: ResolvedFactSubject,
  opts: { statuses?: readonly FactStatus[] } = {}
): Promise<StoredFactRow[]> {
  if (subject.organization_id !== organizationId) return [];
  const ref = subjectRef(subject);
  const statuses = opts.statuses ?? null;
  const r = await q.query<Omit<StoredFactRow, "subject">>(
    `SELECT ${SELECT_COLUMNS}
       FROM assessment_facts
      WHERE organization_id = $1 AND subject_type = $2 AND subject_id = $3
        AND ($4::text[] IS NULL OR status = ANY($4::text[]))
      ORDER BY created_at ASC, id ASC`,
    [organizationId, ref.subject_type, ref.subject_id, statuses]
  );
  return r.rows.map((row) => ({ ...row, subject: ref }));
}

// ── Mirrors ─────────────────────────────────────────────────────────────────

const INHERENT_FIELDS = Object.keys(CORE_FACT_KEYS) as ReadonlyArray<keyof InherentRiskInput>;

function systemProvenance(via: string, evidence: { table: string; id: string } | null): FactProvenance {
  return { actor: { kind: "system", id: null }, via, at: new Date().toISOString(), evidence, model: null };
}

/** The 13 inherent inputs → core.* (intake / intake), observed + verified at the engagement's updated_at. */
export async function mirrorInherentFacts(
  q: Queryable,
  organizationId: string,
  subject: ResolvedFactSubject,
  inherent: InherentRiskInput,
  via = "scope_resolve:mirror"
): Promise<WriteFactsResult> {
  const writes: FactWrite[] = INHERENT_FIELDS.map((field) => ({
    fact_key: CORE_FACT_KEYS[field],
    value: inherent[field],
    source: "intake",
    origin: "intake",
    observed_at: subject.updated_at,
    provenance: systemProvenance(via, { table: "vendor_engagements", id: subject.id }),
  }));
  return writeFacts(q, organizationId, subject, writes);
}

/** vendors.template_metadata.flags → data.personal_data / ai.uses_ai. Absent flags write nothing. */
export async function mirrorVendorProfileFacts(
  q: Queryable,
  organizationId: string,
  subject: ResolvedFactSubject,
  via = "scope_resolve:mirror"
): Promise<WriteFactsResult> {
  const v = await q.query<{ id: string; flags: Record<string, unknown> | null; updated_at: Date | null }>(
    `SELECT id, template_metadata -> 'flags' AS flags, updated_at
       FROM vendors WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [subject.vendor_id, organizationId]
  );
  const vendor = v.rows[0];
  const flags = vendor?.flags && typeof vendor.flags === "object" ? vendor.flags : {};
  const observed = vendor?.updated_at instanceof Date ? vendor.updated_at : new Date();
  const writes: FactWrite[] = [];
  const evidence = vendor ? { table: "vendors", id: vendor.id } : null;
  if (flags["processes_pii"] === true || flags["processes_phi"] === true) {
    writes.push({ fact_key: "data.personal_data", value: true, source: "system_derived", origin: "vendor_profile", observed_at: observed, provenance: systemProvenance(via, evidence) });
  }
  if (flags["processes_ai_inference"] === true) {
    writes.push({ fact_key: "ai.uses_ai", value: true, source: "system_derived", origin: "vendor_profile", observed_at: observed, provenance: systemProvenance(via, evidence) });
  }
  return writeFacts(q, organizationId, subject, writes);
}

/**
 * ai_system_vendor_dependencies (active, THIS engagement's vendor, same org) →
 * ai.uses_ai; role model_provider → ai.third_party_models. A dependency role
 * is not a declaration: `training_data` infers nothing.
 */
export async function mirrorAiDependencyFacts(
  q: Queryable,
  organizationId: string,
  subject: ResolvedFactSubject,
  via = "scope_resolve:mirror"
): Promise<WriteFactsResult> {
  const deps = await q.query<{ id: string; dependency_role: string; created_at: Date }>(
    `SELECT id, dependency_role, created_at
       FROM ai_system_vendor_dependencies
      WHERE vendor_id = $1 AND organization_id = $2 AND deleted_at IS NULL
      ORDER BY created_at ASC, id ASC`,
    [subject.vendor_id, organizationId]
  );
  const writes: FactWrite[] = [];
  const first = deps.rows[0];
  if (first) {
    writes.push({
      fact_key: "ai.uses_ai", value: true, source: "system_derived", origin: "ai_system_dependency",
      observed_at: first.created_at, provenance: systemProvenance(via, { table: "ai_system_vendor_dependencies", id: first.id }),
    });
    const provider = deps.rows.find((d) => d.dependency_role === "model_provider");
    if (provider) {
      writes.push({
        fact_key: "ai.third_party_models", value: true, source: "system_derived", origin: "ai_system_dependency",
        observed_at: provider.created_at, provenance: systemProvenance(via, { table: "ai_system_vendor_dependencies", id: provider.id }),
      });
    }
  }
  return writeFacts(q, organizationId, subject, writes);
}

/** All three mirrors, in a fixed order. The caller has already checked the subject is scope-mutable. */
export async function mirrorSubjectFacts(
  q: Queryable,
  organizationId: string,
  subject: ResolvedFactSubject,
  inherent: InherentRiskInput,
  via = "scope_resolve:mirror"
): Promise<WriteFactsResult> {
  const parts = [
    await mirrorInherentFacts(q, organizationId, subject, inherent, via),
    await mirrorVendorProfileFacts(q, organizationId, subject, via),
    await mirrorAiDependencyFacts(q, organizationId, subject, via),
  ];
  return parts.reduce<WriteFactsResult>(
    (acc, p) => ({
      inserted: acc.inserted + p.inserted,
      unchanged: acc.unchanged + p.unchanged,
      superseded: acc.superseded + p.superseded,
      keys: [...acc.keys, ...p.keys.filter((k) => !acc.keys.includes(k))],
    }),
    { inserted: 0, unchanged: 0, superseded: 0, keys: [] }
  );
}
