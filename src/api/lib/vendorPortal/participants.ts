/**
 * participants.ts — who may work on one vendor assessment (VA-P1).
 *
 * TWO CALLERS, ONE DEFINITION. A participant can be added from the customer
 * side (an admin on the engagement page) or from the vendor side (the
 * coordinator inviting their counsel from inside the portal). Those two paths
 * authenticate through completely disjoint worlds — API key + org context
 * versus a portal session cookie — and if each wrote its own version of "add a
 * participant and mint their credential" the two would drift, which on this
 * surface means one of them eventually forgets a scope predicate.
 *
 * So the rules live here once:
 *
 *   - a participant is a CONTACT (VA-C1) on an ENGAGEMENT, never a new person;
 *   - the contact must belong to the engagement's vendor — enforced in SQL
 *     here AND by a trigger in 20261057, because this is the check that stops
 *     one supplier being invited into another's questionnaire;
 *   - re-inviting somebody already on the engagement REUSES their row and mints
 *     a fresh credential; it never creates a second identity for one human;
 *   - the single-active-invite rule is per participant: minting revokes that
 *     participant's live invite and its live sessions, and touches nobody else.
 *
 * Every function here expects to be called INSIDE a tenant transaction
 * (withTenant / asTenant) except where a parameter says otherwise. They use the
 * ambient `pg` client so they inherit the caller's transaction and roll back
 * with it.
 */

import { pg } from "../../infra/postgres.js";
import { mintInviteToken } from "./portalTokens.js";

export const PARTICIPANT_ROLES = ["coordinator", "contributor"] as const;
export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];

export const PARTICIPANT_STATUSES = ["invited", "active", "revoked"] as const;
export type ParticipantStatus = (typeof PARTICIPANT_STATUSES)[number];

export type ParticipantRow = {
  id: string;
  organization_id: string;
  vendor_id: string;
  engagement_id: string;
  contact_id: string;
  participant_role: ParticipantRole;
  status: ParticipantStatus;
  invited_by_user_id: string | null;
  invited_by_participant_id: string | null;
  first_accepted_at: string | null;
  last_accepted_at: string | null;
  revoked_at: string | null;
  revocation_reason: string | null;
  created_at: string;
  updated_at: string;
};

/** A participant joined to the person they are — what both UIs actually render. */
export type ParticipantView = ParticipantRow & {
  full_name: string;
  email: string;
  title: string | null;
  contact_status: string;
  /** Live credential state. NEVER includes token material. */
  invite_id: string | null;
  invite_expires_at: string | null;
  invite_created_at: string | null;
  invite_exchange_count: number | null;
};

const PARTICIPANT_COLUMNS = `
  p.id, p.organization_id, p.vendor_id, p.engagement_id, p.contact_id,
  p.participant_role, p.status, p.invited_by_user_id, p.invited_by_participant_id,
  p.first_accepted_at, p.last_accepted_at, p.revoked_at, p.revocation_reason,
  p.created_at, p.updated_at`;

/**
 * The participant list for one engagement, newest-role-first.
 *
 * The joined invite is the participant's LIVE credential only (revoked_at IS
 * NULL). Superseded invites stay in the table as history and deliberately do
 * not surface here — "who can get in right now" is the question this answers.
 * No token material is selected; only a hash exists at rest anyway.
 */
export async function listParticipants(
  organizationId: string,
  engagementId: string
): Promise<ParticipantView[]> {
  const res = await pg.query<ParticipantView>(
    `SELECT ${PARTICIPANT_COLUMNS},
            c.full_name, c.email, c.title, c.status AS contact_status,
            i.id AS invite_id, i.expires_at AS invite_expires_at,
            i.created_at AS invite_created_at, i.exchange_count AS invite_exchange_count
       FROM vendor_engagement_participants p
       JOIN vendor_contacts c ON c.id = p.contact_id
       LEFT JOIN vendor_engagement_invites i
              ON i.participant_id = p.id AND i.revoked_at IS NULL
      WHERE p.organization_id = $1 AND p.engagement_id = $2
      ORDER BY (p.participant_role = 'coordinator') DESC,
               (p.status = 'revoked') ASC,
               lower(c.full_name) ASC`,
    [organizationId, engagementId]
  );
  return res.rows;
}

/**
 * One participant of one engagement, or nothing.
 *
 * Scoped by org AND engagement so a participant id from another engagement —
 * even one at the SAME vendor, which is the case org scoping cannot catch — is
 * indistinguishable from one that never existed.
 */
export async function resolveParticipant(
  organizationId: string,
  engagementId: string,
  participantId: string
): Promise<ParticipantRow | null> {
  const res = await pg.query<ParticipantRow>(
    `SELECT ${PARTICIPANT_COLUMNS}
       FROM vendor_engagement_participants p
      WHERE p.id = $1 AND p.organization_id = $2 AND p.engagement_id = $3
      LIMIT 1`,
    [participantId, organizationId, engagementId]
  );
  return res.rows[0] ?? null;
}

export type AddParticipantFailure =
  | "engagement_not_found"
  | "contact_not_found"
  | "contact_inactive"
  | "already_participating"
  | "coordinator_exists";

export type AddParticipantResult =
  | {
      ok: true;
      participant: ParticipantRow;
      reused: boolean;
      inviteToken: string;
      inviteId: string;
      expiresAt: Date;
      contactEmail: string;
      contactName: string;
    }
  | { ok: false; failure: AddParticipantFailure };

/**
 * Add (or re-invite) a person on an engagement and mint their credential.
 *
 * `invitedBy` names who is doing this — a customer user or the vendor's own
 * coordinator, never both. A customer-side add through an API key has no user
 * behind it and records neither, which is the same thing created_by_user_id
 * already means everywhere else on this platform. The VENDOR side is always
 * attributed: the portal route refuses to add anyone unless the caller has a
 * participant row of their own, because an unattributable participant invited
 * by an unattributable participant is precisely what this package removes.
 *
 * Returns the RAW invite token exactly once. It is never persisted (only its
 * SHA-256 is) and must not be logged, audited, or stored by the caller.
 */
export async function addParticipant(args: {
  organizationId: string;
  engagementId: string;
  contactId: string;
  role: ParticipantRole;
  invitedBy: { userId: string | null } | { participantId: string };
}): Promise<AddParticipantResult> {
  const { organizationId, engagementId, contactId, role } = args;

  // The engagement, and through it the vendor every other check hangs on. Read
  // inside the caller's tenant transaction, so a cross-tenant engagement id is
  // simply absent.
  const eng = await pg.query<{ vendor_id: string }>(
    `SELECT vendor_id FROM vendor_engagements
      WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [engagementId, organizationId]
  );
  const vendorId = eng.rows[0]?.vendor_id;
  if (!vendorId) return { ok: false, failure: "engagement_not_found" };

  // THE VENDOR BOUNDARY. The contact must belong to THIS engagement's vendor.
  // Both suppliers may be the same customer's, so the org predicate alone
  // proves nothing here — vendor_id is the whole check. 20261057's trigger
  // enforces the same thing at the database, because a route is a bad place for
  // the only copy of an isolation rule.
  const contact = await pg.query<{ id: string; full_name: string; email: string; status: string }>(
    `SELECT id, full_name, email, status FROM vendor_contacts
      WHERE id = $1 AND organization_id = $2 AND vendor_id = $3 LIMIT 1`,
    [contactId, organizationId, vendorId]
  );
  const person = contact.rows[0];
  if (!person) return { ok: false, failure: "contact_not_found" };
  if (person.status !== "active") return { ok: false, failure: "contact_inactive" };

  // Already on this engagement? Re-use the row. Two rows for one human would
  // mean their answers were attributed to two different people.
  const existing = await pg.query<ParticipantRow>(
    `SELECT ${PARTICIPANT_COLUMNS} FROM vendor_engagement_participants p
      WHERE p.organization_id = $1 AND p.engagement_id = $2 AND p.contact_id = $3
      LIMIT 1`,
    [organizationId, engagementId, contactId]
  );

  let participant = existing.rows[0] ?? null;
  const reused = participant !== null;

  if (participant) {
    // Re-inviting a live participant is a RESEND, not an error: the link
    // expired, or it went to a spam folder. Re-inviting a REVOKED one restores
    // access deliberately, which is why it returns to `invited` rather than
    // silently to `active` — they have to walk through the door again.
    const restored = await pg.query<ParticipantRow>(
      `UPDATE vendor_engagement_participants
          SET status = CASE WHEN first_accepted_at IS NOT NULL AND revoked_at IS NULL
                            THEN status ELSE 'invited' END,
              revoked_at = NULL,
              revoked_by_user_id = NULL,
              revoked_by_participant_id = NULL,
              revocation_reason = NULL,
              updated_at = NOW()
        WHERE id = $1
      RETURNING ${PARTICIPANT_COLUMNS.replace(/p\./g, "")}`,
      [participant.id]
    );
    participant = restored.rows[0]!;
  } else {
    if (role === "coordinator") {
      // The partial unique index would refuse this anyway; catching it here
      // gives the caller a name for what went wrong instead of a 23505.
      const live = await pg.query(
        `SELECT 1 FROM vendor_engagement_participants
          WHERE organization_id = $1 AND engagement_id = $2
            AND participant_role = 'coordinator' AND status <> 'revoked'
          LIMIT 1`,
        [organizationId, engagementId]
      );
      if ((live.rowCount ?? 0) > 0) return { ok: false, failure: "coordinator_exists" };
    }

    const inserted = await pg.query<ParticipantRow>(
      `INSERT INTO vendor_engagement_participants
         (organization_id, vendor_id, engagement_id, contact_id, participant_role,
          invited_by_user_id, invited_by_participant_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${PARTICIPANT_COLUMNS.replace(/p\./g, "")}`,
      [
        organizationId,
        vendorId,
        engagementId,
        contactId,
        role,
        "userId" in args.invitedBy ? args.invitedBy.userId : null,
        "participantId" in args.invitedBy ? args.invitedBy.participantId : null,
      ]
    );
    participant = inserted.rows[0]!;
  }

  // Single-active-invite, PER PARTICIPANT. The old credential and every session
  // minted from it die as the replacement is born; other participants are
  // untouched. The partial unique index on (participant_id) WHERE revoked_at IS
  // NULL makes this mandatory rather than remembered.
  const superseded = await revokeParticipantCredentials(
    organizationId,
    participant.id,
    "superseded by re-issue"
  );
  void superseded;

  const invite = mintInviteToken();
  // TENANT CHANNEL, deliberately unlike the legacy invite mints in
  // vendorEngagements.ts.
  //
  // Those write on pgElevated because an invite is READ before org context
  // exists. This one cannot: its participant_id points at a row created earlier
  // in the CALLER'S still-open transaction, so a second connection's foreign-key
  // check would block on that transaction while that transaction waits on this
  // query — a deadlock, and the first version of this file duly hung.
  //
  // Writing it here is also more correct, not just necessary: the participant
  // and the credential that belongs to them become one atomic fact, so a
  // failure cannot leave a participant with no way in or an invite pointing at
  // nobody. RLS permits it — the policy's WITH CHECK matches organization_id,
  // which is set on this transaction — and the elevated resolver still reads
  // the row perfectly well once committed.
  const insertedInvite = await pg.query<{ id: string }>(
    `INSERT INTO vendor_engagement_invites
       (organization_id, engagement_id, invite_token_hash, contact_email, contact_name,
        expires_at, created_by_user_id, contact_id, participant_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      organizationId,
      engagementId,
      invite.tokenHash,
      person.email,
      person.full_name,
      invite.expiresAt,
      "userId" in args.invitedBy ? args.invitedBy.userId : null,
      contactId,
      participant.id,
    ]
  );

  return {
    ok: true,
    participant,
    reused,
    inviteToken: invite.token,
    inviteId: insertedInvite.rows[0]!.id,
    expiresAt: invite.expiresAt,
    contactEmail: person.email,
    contactName: person.full_name,
  };
}

/**
 * Kill one participant's live credentials and the sessions minted from them.
 *
 * Separated from the status change because it is used by BOTH revocation and
 * re-issue, and because it is the half that must be exact: leaving one live
 * session behind means revocation was theatre.
 *
 * Returns what it actually killed so the caller can audit real numbers rather
 * than an assumption.
 */
export async function revokeParticipantCredentials(
  organizationId: string,
  participantId: string,
  reason: string,
  revokedByUserId: string | null = null
): Promise<{ invites: number; sessions: number }> {
  const invites = await pg.query<{ id: string }>(
    `UPDATE vendor_engagement_invites
        SET revoked_at = NOW(), revoked_by_user_id = $3, revocation_reason = $4
      WHERE participant_id = $1 AND organization_id = $2 AND revoked_at IS NULL
      RETURNING id`,
    [participantId, organizationId, revokedByUserId, reason]
  );
  if ((invites.rowCount ?? 0) === 0) return { invites: 0, sessions: 0 };

  // requirePortalSession re-reads the invite on EVERY request and treats invite
  // revocation as session revocation, so the line above is already sufficient.
  // Revoking the sessions too is not redundancy for its own sake: it makes the
  // session table tell the truth to anyone reading it, and it does not depend
  // on that middleware behaviour continuing to exist.
  const sessions = await pg.query<{ id: string }>(
    `UPDATE vendor_portal_sessions
        SET revoked_at = NOW()
      WHERE invite_id = ANY($1::uuid[]) AND organization_id = $2 AND revoked_at IS NULL
      RETURNING id`,
    [invites.rows.map((r) => r.id), organizationId]
  );

  return { invites: invites.rowCount ?? 0, sessions: sessions.rowCount ?? 0 };
}

/**
 * Revoke a participant: access ends, history stays.
 *
 * The ratified ruling, applied literally. Nothing this person authored is
 * touched — answers, revisions, evidence, comments and audit rows all keep
 * pointing at the invite that produced them, and that invite keeps pointing
 * here. Their name stays on their work; only the door closes.
 */
export async function revokeParticipant(args: {
  organizationId: string;
  participantId: string;
  reason: string;
  revokedBy: { userId: string | null } | { participantId: string };
}): Promise<{ invites: number; sessions: number }> {
  const { organizationId, participantId, reason } = args;

  const killed = await revokeParticipantCredentials(
    organizationId,
    participantId,
    reason,
    "userId" in args.revokedBy ? args.revokedBy.userId : null
  );

  await pg.query(
    `UPDATE vendor_engagement_participants
        SET status = 'revoked', revoked_at = NOW(), revocation_reason = $2,
            revoked_by_user_id = $3, revoked_by_participant_id = $4, updated_at = NOW()
      WHERE id = $1 AND organization_id = $5 AND revoked_at IS NULL`,
    [
      participantId,
      reason,
      "userId" in args.revokedBy ? args.revokedBy.userId : null,
      "participantId" in args.revokedBy ? args.revokedBy.participantId : null,
      organizationId,
    ]
  );

  return killed;
}
