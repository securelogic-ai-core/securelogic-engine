/**
 * lifecycleEvents.ts — the five data-lifecycle events, declared as data.
 *
 * WHY THIS FILE EXISTS. "Deletion" is not one thing, and the operator ruling of
 * 2026-08-16 is explicit that these five must be distinguished rather than
 * collapsed. They differ in what triggers them, what they destroy, what they
 * preserve, and whether a legal hold outranks them. Left implicit, that
 * distinction lives only in prose and drifts the first time someone adds a
 * delete path — so it is declared here, and pinned by tests.
 *
 * THE RULING, in one sentence: an Ask conversation is an ORGANIZATION-GOVERNED
 * RECORD. It does not die with its author. It is preserved under the
 * organization's applicable TDG retention policy, its provenance and audit
 * relationships are preserved with it, and a legal hold outranks the retention
 * policy.
 */

import type { DeletionTrigger } from "./governanceAudit.js";

export type LifecycleEventKey =
  | "account_deletion"
  | "owner_conversation_deletion"
  | "administrator_deletion"
  | "organization_erasure"
  | "retention_expiration"
  | "legal_hold";

/** What the event does to objects of a governed data class. */
export type LifecycleDisposition =
  /** The objects survive; something else about them may be de-identified. */
  | "preserves"
  /** Destroys a bounded, explicitly named set. */
  | "deletes_scoped"
  /** Destroys everything the tenant owns. */
  | "deletes_all"
  /** Destroys nothing; prevents other events from destroying. */
  | "suppresses";

export interface LifecycleEventDefinition {
  readonly key: LifecycleEventKey;
  readonly label: string;
  readonly disposition: LifecycleDisposition;
  /** Does an active legal hold outrank this event? */
  readonly overriddenByLegalHold: boolean;
  /** The audit trigger recorded when this event deletes a governed object. */
  readonly deletionTrigger: DeletionTrigger | null;
  /** Where the behaviour actually lives — checked by review, not by the type. */
  readonly implementedBy: string;
  readonly note: string;
}

export const LIFECYCLE_EVENTS: readonly LifecycleEventDefinition[] = [
  {
    key: "account_deletion",
    label: "Account deletion (GDPR Art. 17, self-service)",
    // THE RULING. Ask conversations are org records: they are NOT deleted with
    // the user. The users row is tombstoned in place — email and name scrubbed,
    // credentials cleared, UUID preserved — so identity is de-identified while
    // every governance reference stays intact.
    disposition: "preserves",
    overriddenByLegalHold: false,
    deletionTrigger: null,
    implementedBy: "workers/accountDeletionReaper.ts + lib/accountDeletionReaperPolicy.ts",
    note:
      "De-identifies the person, preserves the organization's records. ask_conversations is " +
      "deliberately ABSENT from CATEGORY_B_DELETE_TABLES, and 20261016 replaced its CASCADE " +
      "with SET NULL so a hard delete could not take the thread with it. Retained " +
      "conversations then expire under the org's TDG policy like any other. A legal hold does " +
      "NOT currently gate the reaper: the reaper is inert in every environment and account " +
      "deletion is a distinct event from retention — wiring the two is an integration decision " +
      "owed before the reaper is ever enabled, not an E-1 behaviour."
  },
  {
    key: "owner_conversation_deletion",
    label: "Owner-requested conversation deletion",
    disposition: "deletes_scoped",
    overriddenByLegalHold: true,
    deletionTrigger: "owner_request",
    implementedBy: "routes/ask.ts DELETE /ask/conversations/:id → retentionService.deleteGovernedObject",
    note:
      "One thread, requested by the person who owns it. Refused with 409 legal_hold_active " +
      "rather than silently skipped. A thread whose owner has been deleted has no owner path " +
      "left — only an administrator can remove it."
  },
  {
    key: "administrator_deletion",
    label: "Administrator deletion",
    disposition: "deletes_scoped",
    overriddenByLegalHold: true,
    deletionTrigger: "administrator",
    implementedBy: "routes/dataGovernance.ts DELETE /governance/objects/:dataClass/:id",
    note:
      "The organization removing its own record. Requires the admin role and destroys an " +
      "object the administrator has no right to READ — the action plane without the content " +
      "plane."
  },
  {
    key: "retention_expiration",
    label: "Retention expiration (automated)",
    disposition: "deletes_scoped",
    overriddenByLegalHold: true,
    deletionTrigger: "retention_expiry",
    implementedBy: "lib/governance/retentionSweepEnqueuer.ts → workers/retentionSweepJob.ts",
    note:
      "Age-based, deterministic, per (organization, data class). Held objects are skipped and " +
      "counted, never refused. Doubly gated: the TDG flag, then an effective-from date plus a " +
      "30-day grace window."
  },
  {
    key: "organization_erasure",
    label: "Organization erasure (tenant offboarding)",
    disposition: "deletes_all",
    overriddenByLegalHold: true,
    deletionTrigger: null,
    implementedBy: "NOT BUILT — blocked by KNOWN_ISSUES D-12; proposed mechanism in ADR-0005",
    note:
      "Everything the tenant owns, including the conversations every other event preserves. " +
      "Currently IMPOSSIBLE, not merely unbuilt: WORM triggers fire on FK cascade, so " +
      "DELETE FROM organizations raises. CORRECTED 2026-08-16 (E-2 discovery): an earlier " +
      "version of this note claimed E-1 'adds nothing to the cascade web' because its actor " +
      "columns are ON DELETE SET NULL. That was WRONG on both counts. A SET NULL cascade is " +
      "an UPDATE, and these triggers guard UPDATE OR DELETE — so SET NULL does not avoid the " +
      "web at all; and organization_id on both tables is ON DELETE CASCADE regardless. " +
      "legal_holds and retention_policies are now two of the NINE blocking tables, verified " +
      "against a real database: an org holding only a retention_policies row, or only a " +
      "legal_holds row, cannot be deleted. Removing them from the web is E-2's job, not a " +
      "property E-1 ever had."
  },
  {
    key: "legal_hold",
    label: "Legal hold",
    disposition: "suppresses",
    overriddenByLegalHold: false,
    deletionTrigger: null,
    implementedBy: "lib/governance/holdPredicate.ts, enforced inside retentionService.deleteGovernedObject",
    note:
      "Not a deletion event — the event that stops the others. Outranks owner deletion, " +
      "administrator deletion and retention expiration alike. Placement and release require " +
      "the admin role, a named human and a reason; release requires a DIFFERENT admin than the " +
      "placer, enforced at the route and by a database CHECK."
  }
] as const;

const BY_KEY = new Map<LifecycleEventKey, LifecycleEventDefinition>(
  LIFECYCLE_EVENTS.map((e) => [e.key, e])
);

export function getLifecycleEvent(key: LifecycleEventKey): LifecycleEventDefinition {
  const found = BY_KEY.get(key);
  if (!found) throw new Error(`unknown lifecycle event '${key}'`);
  return found;
}

/** Events a legal hold outranks. Used by docs and tests, not by the delete path. */
export function eventsOverriddenByLegalHold(): readonly LifecycleEventDefinition[] {
  return LIFECYCLE_EVENTS.filter((e) => e.overriddenByLegalHold);
}
