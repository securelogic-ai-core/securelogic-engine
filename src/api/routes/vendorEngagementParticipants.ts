/**
 * vendorEngagementParticipants.ts — the customer's view of who is working on
 * their assessment (VA-P1).
 *
 * The vendor side of this lives in vendorPortal.ts and both call the SAME
 * functions in lib/vendorPortal/participants.ts. That is deliberate: the two
 * surfaces authenticate through disjoint worlds (API key + org context here, a
 * session cookie there) and the moment each owns its own copy of "add a
 * participant", one of them forgets a vendor predicate.
 *
 * What the customer can do that the vendor cannot:
 *   - see who invited whom, including which of their OWN users did it;
 *   - name the coordinator (the vendor may not promote themselves);
 *   - add a participant directly, without going through the coordinator.
 *
 * What neither can do: reach another tenant's or another supplier's people.
 * Every query carries organization_id AND engagement_id, the contact is
 * re-checked against the engagement's vendor, and 20261057's trigger refuses
 * any row where those three disagree.
 */

import { Router } from "express";
import type { Request, Response } from "express";

import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";
import { requireApiKey } from "../middleware/requireApiKey.js";
import { attachOrganizationContext } from "../middleware/attachOrganizationContext.js";
import { requireEntitlement } from "../middleware/requireEntitlement.js";
import { denyContributor } from "../middleware/requireSeat.js";
import { asTenant } from "../middleware/asTenant.js";
import { writeAuditEvent } from "../lib/auditLog.js";
import { vendorAssuranceFeatureFlag } from "../lib/vendorAssuranceFeatureFlag.js";
import { sendVendorInviteEmail } from "../lib/vendorPortal/inviteEmail.js";
import {
  PARTICIPANT_ROLES,
  addParticipant,
  listParticipants,
  resolveParticipant,
  revokeParticipant,
  type ParticipantRole,
} from "../lib/vendorPortal/participants.js";

const router = Router();

const GUARDS = [
  vendorAssuranceFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  // Deciding who at a third party holds a credential to your assessment is a
  // governance act, the same posture the engagement and contact routes take.
  denyContributor(),
] as const;

function orgOf(req: Request): string | null {
  return (req as Request & { organizationContext?: { organizationId?: string } })
    .organizationContext?.organizationId ?? null;
}

function userOf(req: Request): string | null {
  return (req as Request & { userId?: string }).userId ?? null;
}

/** The engagement, inside the caller's tenant, or nothing. */
async function ownEngagement(organizationId: string, engagementId: string): Promise<boolean> {
  const res = await pg.query(
    `SELECT 1 FROM vendor_engagements WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [engagementId, organizationId]
  );
  return (res.rowCount ?? 0) > 0;
}

/* =========================================================
   GET /api/vendor-engagements/:id/participants
   ========================================================= */

router.get(
  "/vendor-engagements/:id/participants",
  ...GUARDS,
  asTenant(async (req: Request, res: Response) => {
    const organizationId = orgOf(req);
    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }
    const engagementId = String(req.params["id"] ?? "");

    try {
      if (!(await ownEngagement(organizationId, engagementId))) {
        res.status(404).json({ error: "engagement_not_found" });
        return;
      }
      const participants = await listParticipants(organizationId, engagementId);
      res.status(200).json({
        participants,
        count: participants.length,
        active_count: participants.filter((p) => p.status !== "revoked").length,
        // Whether anybody can actually submit. An engagement whose coordinator
        // was revoked is a real state and the customer needs to see it, because
        // the fix (name a new coordinator) is theirs to make.
        has_coordinator: participants.some(
          (p) => p.participant_role === "coordinator" && p.status !== "revoked"
        ),
      });
    } catch (err) {
      logger.error(
        { event: "engagement_participants_list_failed", organizationId, err },
        "Participant list failed"
      );
      res.status(500).json({ error: "engagement_participants_list_failed" });
    }
  })
);

/* =========================================================
   POST /api/vendor-engagements/:id/participants

   Add a person to the assessment and mint their credential. Also the RESEND
   path: naming somebody already on the engagement re-uses their row and
   supersedes only THEIR link.
   ========================================================= */

router.post(
  "/vendor-engagements/:id/participants",
  ...GUARDS,
  asTenant(async (req: Request, res: Response) => {
    const organizationId = orgOf(req);
    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }
    const engagementId = String(req.params["id"] ?? "");
    const body = (req.body ?? {}) as Record<string, unknown>;
    const contactId = typeof body.contact_id === "string" ? body.contact_id.trim() : "";
    const roleInput = typeof body.participant_role === "string" ? body.participant_role.trim() : "contributor";

    if (!contactId) {
      res.status(400).json({
        error: "contact_id_required",
        message: "Choose someone from this supplier's contact directory.",
      });
      return;
    }
    if (!PARTICIPANT_ROLES.includes(roleInput as ParticipantRole)) {
      res.status(400).json({ error: "invalid_participant_role", allowed: [...PARTICIPANT_ROLES] });
      return;
    }

    try {
      if (!(await ownEngagement(organizationId, engagementId))) {
        res.status(404).json({ error: "engagement_not_found" });
        return;
      }

      const added = await addParticipant({
        organizationId,
        engagementId,
        contactId,
        role: roleInput as ParticipantRole,
        invitedBy: { userId: userOf(req) },
      });

      if (!added.ok) {
        const status =
          added.failure === "engagement_not_found" || added.failure === "contact_not_found"
            ? 404
            : 409;
        res.status(status).json({ error: added.failure });
        return;
      }

      const orgName = await pg.query<{ name: string }>(
        `SELECT name FROM organizations WHERE id = $1`,
        [organizationId]
      );
      const emailDelivery = await sendVendorInviteEmail({
        contactEmail: added.contactEmail,
        contactName: added.contactName,
        organizationName: orgName.rows[0]?.name ?? "Your customer",
        rawToken: added.inviteToken,
        expiresAt: added.expiresAt,
      });

      writeAuditEvent({
        organizationId,
        actorUserId: userOf(req),
        eventType: "vendor_engagement.participant_added",
        resourceType: "vendor_engagement",
        resourceId: engagementId,
        // The token is NEVER here. An audit log readable by more people than
        // the vendor's mailbox must not contain a working credential.
        payload: {
          participant_id: added.participant.id,
          contact_id: contactId,
          invite_id: added.inviteId,
          participant_role: roleInput,
          reused_participant: added.reused,
          email_delivery: emailDelivery,
        },
        ipAddress: req.ip ?? null,
      });

      res.status(201).json({
        participant_id: added.participant.id,
        reused: added.reused,
        // Shown ONCE. Only a hash is persisted; this is the only moment the raw
        // value exists outside the vendor's mailbox.
        invite_token: added.inviteToken,
        expires_at: added.expiresAt.toISOString(),
        email_delivery: emailDelivery,
      });
    } catch (err) {
      logger.error(
        { event: "engagement_participant_add_failed", organizationId, err },
        "Participant add failed"
      );
      res.status(500).json({ error: "engagement_participant_add_failed" });
    }
  })
);

/* =========================================================
   POST /api/vendor-engagements/:id/participants/:participantId/revoke

   Access is revoked. History is preserved.
   ========================================================= */

router.post(
  "/vendor-engagements/:id/participants/:participantId/revoke",
  ...GUARDS,
  asTenant(async (req: Request, res: Response) => {
    const organizationId = orgOf(req);
    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }
    const engagementId = String(req.params["id"] ?? "");
    const participantId = String(req.params["participantId"] ?? "");
    const body = (req.body ?? {}) as Record<string, unknown>;
    const reason =
      typeof body.reason === "string" && body.reason.trim()
        ? body.reason.trim().slice(0, 500)
        : "revoked by customer";

    try {
      if (!(await ownEngagement(organizationId, engagementId))) {
        res.status(404).json({ error: "engagement_not_found" });
        return;
      }
      // Scoped to org AND engagement: a participant id from a different
      // engagement — including one at the same vendor — is indistinguishable
      // from one that never existed.
      const target = await resolveParticipant(organizationId, engagementId, participantId);
      if (!target) {
        res.status(404).json({ error: "participant_not_found" });
        return;
      }
      if (target.status === "revoked") {
        res.status(200).json({ ok: true, already_revoked: true, invites: 0, sessions: 0 });
        return;
      }

      const killed = await revokeParticipant({
        organizationId,
        participantId,
        reason,
        revokedBy: { userId: userOf(req) },
      });

      writeAuditEvent({
        organizationId,
        actorUserId: userOf(req),
        eventType: "vendor_engagement.participant_revoked",
        resourceType: "vendor_engagement",
        resourceId: engagementId,
        payload: {
          participant_id: participantId,
          contact_id: target.contact_id,
          was_coordinator: target.participant_role === "coordinator",
          invites_revoked: killed.invites,
          sessions_revoked: killed.sessions,
          reason,
        },
        ipAddress: req.ip ?? null,
      });

      res.status(200).json({
        ok: true,
        invites_revoked: killed.invites,
        sessions_revoked: killed.sessions,
        // Said plainly rather than left for the customer to discover: revoking
        // the coordinator leaves nobody able to submit until another is named.
        coordinator_vacant: target.participant_role === "coordinator",
      });
    } catch (err) {
      logger.error(
        { event: "engagement_participant_revoke_failed", organizationId, err },
        "Participant revoke failed"
      );
      res.status(500).json({ error: "engagement_participant_revoke_failed" });
    }
  })
);

export default router;
