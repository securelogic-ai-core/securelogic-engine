/**
 * dataClasses.ts — the Tenant Data Governance (TDG) class registry.
 *
 * DB-free by design, like accountDeletionReaperPolicy.ts: this module declares
 * WHAT is governed and under what bounds, so every rule in it is unit-testable
 * without a database. The handlers that actually read and delete rows live in
 * classHandlers.ts, which is the only TDG module that touches Postgres.
 *
 * ── Why a registry at all ───────────────────────────────────────────────────
 *
 * Retention, deletion, hold and erasure are one question asked of different
 * DATA CLASSES. Ask conversations are the first class registered here; `jobs`,
 * `data_export_files` and `email_provider_events` are expected to follow. The
 * invariant that makes that cheap (TDG-15) is that governing a new class needs
 * ONE entry in this file plus a handler pair — no migration, no new table, no
 * route change, no worker change. If a future class cannot be expressed as an
 * entry here, that is a design defect in the entry shape, not a reason to add a
 * bespoke code path.
 *
 * Nothing in this module names Ask in its logic. `ask_conversation` is a value.
 *
 * ── The two entries, and why the second one matters ─────────────────────────
 *
 * `ask_tool_invocation` is registered NOT because anyone will tune it — it is
 * deliberately `tenantConfigurable: false` — but because registering it is what
 * makes the provenance invariant (TDG-5) expressible as data rather than as a
 * special case: `ask_conversation.dependsOn` names it, and the resolver refuses
 * any policy that would let content outlive the ledger that substantiates it.
 * A registry whose first two members already differ in configurability is one
 * that has been shown to generalise.
 *
 * `ask_provenance_contexts` is deliberately NOT registered: it purges itself in
 * the same transaction that attaches claims (20261010), so its steady state is
 * empty and there is nothing for a retention policy to govern.
 */

import type { DataCategory } from "../dataClassification.js";

/**
 * What an account/organization erasure does with this class. Cross-checked
 * against dataClassification.ts by a drift test (TDG-11) so the registry and
 * the classification can never disagree about the same tables.
 *
 *   org_content   — org work product; survives a user erasure, dies with the org
 *   user_content  — dies with the user
 *   system_ledger — a record of what the SYSTEM did; outlives both, subject only
 *                   to its own retention period
 */
export type ErasureDisposition = "org_content" | "user_content" | "system_ledger";

export interface GovernedDataClass {
  /** Stable key. Appears in retention_policies rows, legal_holds and audit events. */
  readonly key: string;
  readonly label: string;
  /** Tables this class governs. Used by the classification drift test. */
  readonly tables: readonly string[];
  /**
   * The column that anchors "how old is this object". Paired with
   * ageFallbackColumn via COALESCE so a nullable anchor can never make an object
   * immortal (or, worse, instantly expired).
   */
  readonly ageColumn: string;
  readonly ageFallbackColumn: string;
  /** Applied when the organization has no override (TDG-2). */
  readonly defaultDays: number;
  /** Inclusive tenant bounds. Values outside are REJECTED, never clamped (TDG-4). */
  readonly minDays: number;
  readonly maxDays: number;
  readonly tenantConfigurable: boolean;
  /**
   * Classes whose retention this one may never exceed (TDG-5). Content must not
   * outlive the evidence that substantiates it.
   */
  readonly dependsOn: readonly string[];
  /** Columns identifying the data subject, for subject-scoped holds. */
  readonly subjectColumns: readonly string[];
  readonly erasureDisposition: ErasureDisposition;
  /** The dataClassification.ts category its tables carry. Drift-tested. */
  readonly classificationCategory: DataCategory;
}

/**
 * The registry. Ordered for readability only; nothing depends on order.
 */
export const GOVERNED_DATA_CLASSES: readonly GovernedDataClass[] = [
  {
    key: "ask_conversation",
    label: "Ask conversations",
    tables: ["ask_conversations", "ask_messages"],
    // A thread's age is the age of its LAST turn: an active thread is not old
    // because it was started a year ago. last_message_at is nullable (a thread
    // created but never used), hence the fallback.
    ageColumn: "last_message_at",
    ageFallbackColumn: "created_at",
    defaultDays: 365,
    minDays: 30,
    maxDays: 365,
    tenantConfigurable: true,
    dependsOn: ["ask_tool_invocation"],
    subjectColumns: ["user_id"],
    // RULED 2026-08-16: an Ask conversation is an ORGANIZATION-GOVERNED RECORD.
    // It does not die with its author — the user is de-identified in place and
    // the thread is preserved under this class's retention policy. See
    // lifecycleEvents.ts, and 20261016 which replaced the user FK's CASCADE
    // with SET NULL so the schema could not contradict the ruling.
    erasureDisposition: "org_content",
    classificationCategory: "C"
  },
  {
    key: "ask_tool_invocation",
    label: "Ask tool-invocation ledger",
    tables: ["ask_tool_invocations"],
    ageColumn: "created_at",
    ageFallbackColumn: "created_at",
    // 12 months, matching the published Privacy Policy §10.4 figure for
    // security and audit logs. Fixed: a customer-shortenable audit ledger is
    // not an audit ledger.
    defaultDays: 365,
    minDays: 365,
    maxDays: 365,
    tenantConfigurable: false,
    dependsOn: [],
    subjectColumns: [],
    erasureDisposition: "system_ledger",
    classificationCategory: "E"
  },
  {
    key: "llm_verdict_cache",
    label: "LLM control-matcher verdict cache",
    tables: ["llm_control_matcher_verdicts"],
    // A verdict's age is simply when it was computed — there is no "last used"
    // anchor, and adding one would mean a write on every cache hit.
    ageColumn: "created_at",
    ageFallbackColumn: "created_at",
    // Retention here is STORAGE HYGIENE, not compliance: every input that could
    // change a verdict is already in its key, so an entry is either still
    // exactly right or already unreachable. Expiry costs a recompute, never a
    // wrong answer — which is why this class can be tenant-configurable with a
    // low floor, unlike the audit ledger above. 90 days captures essentially all
    // reuse value (a signal's re-ask value is concentrated in the weeks it keeps
    // being re-ingested).
    defaultDays: 90,
    minDays: 7,
    maxDays: 365,
    tenantConfigurable: true,
    dependsOn: [],
    // NO subject columns: the rows contain no personal data at all (see the
    // dataClassification entry). This is what makes the category-D ruling of
    // 2026-08-18 unconditional — organization erasure always covers it, and an
    // individual's export/erasure never touches it, because there is nothing
    // in it that relates to a data subject.
    subjectColumns: [],
    erasureDisposition: "org_content",
    classificationCategory: "D"
  }
] as const;

const BY_KEY = new Map<string, GovernedDataClass>(
  GOVERNED_DATA_CLASSES.map((c) => [c.key, c])
);

export function listDataClasses(): readonly GovernedDataClass[] {
  return GOVERNED_DATA_CLASSES;
}

/** Null for an unknown key — callers 404/400 rather than guessing a default. */
export function getDataClass(key: string): GovernedDataClass | null {
  return BY_KEY.get(key) ?? null;
}

export function isGovernedClass(key: string): boolean {
  return BY_KEY.has(key);
}

/**
 * Classes a sweep run should consider, in dependency order: a class is swept
 * only after every class it depends on, so an orphaned ledger row produced by
 * sweeping content becomes eligible in the SAME run rather than the next one.
 *
 * Topological, and it throws on a cycle rather than sorting arbitrarily — a
 * cyclic dependsOn would silently break the TDG-5 invariant.
 */
export function sweepOrder(
  classes: readonly GovernedDataClass[] = GOVERNED_DATA_CLASSES
): readonly GovernedDataClass[] {
  const ordered: GovernedDataClass[] = [];
  const placed = new Set<string>();
  const visiting = new Set<string>();

  const visit = (c: GovernedDataClass): void => {
    if (placed.has(c.key)) return;
    if (visiting.has(c.key)) {
      throw new Error(`TDG registry: dependsOn cycle at '${c.key}'`);
    }
    visiting.add(c.key);
    placed.add(c.key);
    // Dependents first, dependencies after: content is swept before the ledger
    // rows its deletion orphans, so both land in the SAME run.
    ordered.push(c);
    for (const depKey of c.dependsOn) {
      const dep = classes.find((x) => x.key === depKey);
      if (dep) visit(dep);
    }
    visiting.delete(c.key);
  };

  for (const c of classes) visit(c);
  return ordered;
}
