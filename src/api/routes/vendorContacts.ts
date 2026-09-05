/**
 * vendorContacts.ts — the people at a supplier (VA-C1).
 *
 * THE GAP THIS CLOSES. A "vendor contact" used to be a string somebody typed
 * into the issue form: `vendor_engagement_invites.contact_email`, one per
 * engagement, with no identity behind it. You could not re-invite the same
 * person next quarter, could not list who you deal with at a supplier, and
 * could not name a second person at all — which is why multi-participant
 * collaboration had nothing to hang authorisation or attribution on.
 *
 * WHAT A CONTACT IS NOT:
 *
 *   - Not a user. No account, no login, no session. A vendor contact is a data
 *     subject whose PII we hold WITHOUT them having signed up, exactly like the
 *     invite's contact_email today — hence Category C / piiRisk high, and hence
 *     an erasure request can arrive from someone with no way to log in.
 *   - Not an engagement participant. Being the security contact at a supplier
 *     is a standing fact; working on one questionnaire is not. VA-P1 adds
 *     participation and points at this row. If the two were one record,
 *     removing somebody from a single assessment would delete them from the
 *     supplier's directory.
 *
 * DEACTIVATE, DO NOT DELETE. A contact's name is attached to answers, evidence
 * and comments that outlive their employment. DELETE is therefore refused while
 * any invite still references the row (409, not a cascade): the alternative is
 * an audit trail that quietly loses the person it was about.
 *
 * TENANT + VENDOR ISOLATION, both, because org scoping alone is not enough
 * here: two suppliers of the SAME customer must not see into each other, and
 * the ids that would do it are all in the URL.
 *   1. asTenant() opens the request transaction with app.current_org_id set;
 *   2. the vendor is re-verified inside the caller's org before anything else,
 *      so a cross-tenant vendor id 404s rather than listing contacts;
 *   3. every contact query carries BOTH organization_id and vendor_id, so a
 *      contact id from another supplier 404s even inside the right tenant;
 *   4. RLS on vendor_contacts carries USING and WITH CHECK.
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

const router = Router();

export const CONTACT_ROLES = [
  "security",
  "privacy",
  "legal",
  "executive",
  "commercial",
  "other",
] as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME = 200;
const MAX_TITLE = 200;
const MAX_PHONE = 64;
const MAX_NOTES = 2000;

export type VendorContactRow = {
  id: string;
  vendor_id: string;
  full_name: string;
  email: string;
  title: string | null;
  phone: string | null;
  contact_role: string;
  is_primary_contact: boolean;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

const CONTACT_SELECT = `
  id, vendor_id, full_name, email, title, phone, contact_role,
  is_primary_contact, status, notes, created_at, updated_at`;

function orgOf(req: Request): string | null {
  return (req as Request & { organizationContext?: { organizationId?: string } })
    .organizationContext?.organizationId ?? null;
}

function userOf(req: Request): string | null {
  return (req as Request & { userId?: string }).userId ?? null;
}

function str(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/** The caller's own vendor, or nothing. Never distinguishes wrong-tenant from absent. */
async function ownVendor(organizationId: string, vendorId: string): Promise<boolean> {
  const res = await pg.query(
    `SELECT 1 FROM vendors WHERE id = $1 AND organization_id = $2 LIMIT 1`,
    [vendorId, organizationId]
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * Exported for VA-P1 and the issue path: resolve a contact that must belong to
 * BOTH this org and this vendor. Returning null for every failure mode is
 * deliberate — a contact id from another supplier must not be distinguishable
 * from one that never existed.
 */
export async function resolveVendorContact(
  organizationId: string,
  vendorId: string,
  contactId: string
): Promise<VendorContactRow | null> {
  const res = await pg.query<VendorContactRow>(
    `SELECT ${CONTACT_SELECT}
       FROM vendor_contacts
      WHERE id = $1 AND organization_id = $2 AND vendor_id = $3
      LIMIT 1`,
    [contactId, organizationId, vendorId]
  );
  return res.rows[0] ?? null;
}

const GUARDS = [
  vendorAssuranceFeatureFlag,
  requireApiKey,
  attachOrganizationContext,
  requireEntitlement("premium"),
  // Naming who at a third party receives a credential is a governance act, not
  // queue work — the same posture vendorEngagements.ts takes on the engagement.
  denyContributor(),
] as const;

/* =========================================================
   GET /api/vendors/:id/contacts
   ========================================================= */

router.get(
  "/vendors/:id/contacts",
  ...GUARDS,
  asTenant(async (req: Request, res: Response) => {
    const organizationId = orgOf(req);
    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }
    const vendorId = String(req.params["id"] ?? "");

    try {
      if (!(await ownVendor(organizationId, vendorId))) {
        res.status(404).json({ error: "vendor_not_found" });
        return;
      }
      const rows = await pg.query<VendorContactRow>(
        `SELECT ${CONTACT_SELECT}
           FROM vendor_contacts
          WHERE organization_id = $1 AND vendor_id = $2
          ORDER BY is_primary_contact DESC, status ASC, lower(full_name) ASC`,
        [organizationId, vendorId]
      );
      res.status(200).json({
        contacts: rows.rows,
        count: rows.rowCount,
        active_count: rows.rows.filter((r) => r.status === "active").length,
      });
    } catch (err) {
      logger.error({ event: "vendor_contacts_list_failed", organizationId, err }, "Contact list failed");
      res.status(500).json({ error: "vendor_contacts_list_failed" });
    }
  })
);

/* =========================================================
   POST /api/vendors/:id/contacts
   ========================================================= */

router.post(
  "/vendors/:id/contacts",
  ...GUARDS,
  asTenant(async (req: Request, res: Response) => {
    const organizationId = orgOf(req);
    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }
    const vendorId = String(req.params["id"] ?? "");
    const body = (req.body ?? {}) as Record<string, unknown>;

    const fullName = str(body.full_name, MAX_NAME);
    const email = str(body.email, 320);
    const role = typeof body.contact_role === "string" ? body.contact_role.trim() : "security";

    if (!fullName) {
      res.status(400).json({ error: "full_name_required" });
      return;
    }
    if (!email || !EMAIL_RE.test(email)) {
      res.status(400).json({ error: "invalid_email" });
      return;
    }
    if (!CONTACT_ROLES.includes(role as (typeof CONTACT_ROLES)[number])) {
      res.status(400).json({ error: "invalid_contact_role", allowed: [...CONTACT_ROLES] });
      return;
    }

    try {
      if (!(await ownVendor(organizationId, vendorId))) {
        res.status(404).json({ error: "vendor_not_found" });
        return;
      }

      // ── WA-1/WA-2 (owner ruling 1): the HIDDEN-INACTIVE COLLISION ─────────
      //
      // `idx_vendor_contacts_identity` is unique on (org, vendor, lower(email))
      // across ALL rows, but every surface that offers "add a contact" lists
      // only ACTIVE ones. So a deactivated contact is invisible and still owns
      // its address: the issue flow said "No active contacts yet", the customer
      // added the person, and the write was refused with "this supplier already
      // has a contact with that email address" — pointing at a row they could
      // not see and could not reach from where they were standing. Reproduced
      // on staging before this fix.
      //
      // The refusal was correct; it was unexplainable. It now names the row it
      // is talking about and its status, so the caller can offer the one action
      // that resolves it. Nothing is deleted and no history is rewritten — the
      // owner ruling is explicit that this is not solved by destroying the
      // record (a deactivated contact's name is attached to invites, answers
      // and evidence that outlive their employment).
      //
      // PRE-FLIGHT, not a catch. Two reasons, both load-bearing:
      //   1. after a 23505 the transaction is ABORTED, so the catch block
      //      cannot run the SELECT it would need to describe the conflict;
      //   2. it must run BEFORE the primary demotion below. The comment on
      //      that demotion warns that a JS-level early return placed after it
      //      would commit the demotion alongside the refusal and leave the
      //      supplier with no primary contact. This return is above it.
      //
      // The unique index remains the backstop for the race between this read
      // and the insert; the 23505 handler below is unchanged.
      const clash = await pg.query<{ id: string; status: string; full_name: string }>(
        `SELECT id, status, full_name
           FROM vendor_contacts
          WHERE organization_id = $1 AND vendor_id = $2 AND lower(email) = lower($3)
          LIMIT 1`,
        [organizationId, vendorId, email]
      );
      const existing = clash.rows[0];
      if (existing) {
        res.status(409).json({
          error: "contact_already_exists",
          message:
            existing.status === "inactive"
              ? `${existing.full_name} already holds this address but is marked inactive. Reactivate them instead of adding a duplicate — their history stays intact.`
              : "This supplier already has a contact with that email address.",
          contact_id: existing.id,
          contact_status: existing.status,
          contact_name: existing.full_name,
        });
        return;
      }

      const wantsPrimary = body.is_primary_contact === true;
      if (wantsPrimary) {
        // One primary per supplier. Demoting here rather than letting the
        // partial unique index raise means the customer gets the obvious
        // behaviour ("this is now the primary") instead of a 409 they would
        // have to resolve by hand. Same transaction — asTenant wraps the whole
        // handler — so there is no window with two primaries or none.
        //
        // This demotion runs BEFORE the insert that can fail on the duplicate
        // -address index, and it survives that refusal only because the 23505
        // aborts the transaction, so asTenant's COMMIT acts as a ROLLBACK. A
        // JS-level early return added below this point would NOT get that
        // protection — it would commit the demotion alongside the refusal and
        // leave the supplier with no primary contact. Pinned by
        // test/isolation/vendorContacts.test.ts ("a refused write ...").
        await pg.query(
          `UPDATE vendor_contacts SET is_primary_contact = FALSE, updated_at = NOW()
            WHERE organization_id = $1 AND vendor_id = $2 AND is_primary_contact`,
          [organizationId, vendorId]
        );
      }

      const inserted = await pg.query<VendorContactRow>(
        `INSERT INTO vendor_contacts
           (organization_id, vendor_id, full_name, email, title, phone,
            contact_role, is_primary_contact, notes, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING ${CONTACT_SELECT}`,
        [
          organizationId,
          vendorId,
          fullName,
          email,
          str(body.title, MAX_TITLE),
          str(body.phone, MAX_PHONE),
          role,
          wantsPrimary,
          str(body.notes, MAX_NOTES),
          userOf(req),
        ]
      );

      writeAuditEvent({
        organizationId,
        actorUserId: userOf(req),
        eventType: "vendor_contact.created",
        resourceType: "vendor",
        resourceId: vendorId,
        payload: { contact_id: inserted.rows[0]!.id, email, contact_role: role },
        ipAddress: req.ip ?? null,
      });

      res.status(201).json({ contact: inserted.rows[0] });
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        res.status(409).json({
          error: "contact_already_exists",
          message: "This supplier already has a contact with that email address.",
        });
        return;
      }
      logger.error({ event: "vendor_contact_create_failed", organizationId, err }, "Contact create failed");
      res.status(500).json({ error: "vendor_contact_create_failed" });
    }
  })
);

/* =========================================================
   PATCH /api/vendors/:id/contacts/:contactId
   ========================================================= */

router.patch(
  "/vendors/:id/contacts/:contactId",
  ...GUARDS,
  asTenant(async (req: Request, res: Response) => {
    const organizationId = orgOf(req);
    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }
    const vendorId = String(req.params["id"] ?? "");
    const contactId = String(req.params["contactId"] ?? "");
    const body = (req.body ?? {}) as Record<string, unknown>;

    try {
      if (!(await ownVendor(organizationId, vendorId))) {
        res.status(404).json({ error: "vendor_not_found" });
        return;
      }
      const existing = await resolveVendorContact(organizationId, vendorId, contactId);
      if (!existing) {
        res.status(404).json({ error: "contact_not_found" });
        return;
      }

      const patch: string[] = [];
      const params: unknown[] = [contactId, organizationId, vendorId];
      const push = (sql: string, value: unknown): void => {
        params.push(value);
        patch.push(`${sql} = $${params.length}`);
      };

      if (body.full_name !== undefined) {
        const name = str(body.full_name, MAX_NAME);
        if (!name) {
          res.status(400).json({ error: "full_name_required" });
          return;
        }
        push("full_name", name);
      }
      if (body.email !== undefined) {
        const email = str(body.email, 320);
        if (!email || !EMAIL_RE.test(email)) {
          res.status(400).json({ error: "invalid_email" });
          return;
        }
        push("email", email);
      }
      if (body.title !== undefined) push("title", str(body.title, MAX_TITLE));
      if (body.phone !== undefined) push("phone", str(body.phone, MAX_PHONE));
      if (body.notes !== undefined) push("notes", str(body.notes, MAX_NOTES));
      if (body.contact_role !== undefined) {
        const role = typeof body.contact_role === "string" ? body.contact_role.trim() : "";
        if (!CONTACT_ROLES.includes(role as (typeof CONTACT_ROLES)[number])) {
          res.status(400).json({ error: "invalid_contact_role", allowed: [...CONTACT_ROLES] });
          return;
        }
        push("contact_role", role);
      }
      if (body.status !== undefined) {
        const status = typeof body.status === "string" ? body.status.trim() : "";
        if (!["active", "inactive"].includes(status)) {
          res.status(400).json({ error: "invalid_status", allowed: ["active", "inactive"] });
          return;
        }
        push("status", status);
        // A deactivated contact cannot remain the standing primary — the index
        // would allow it (it only covers active rows) and it would be a lie.
        if (status === "inactive") push("is_primary_contact", false);
      }
      if (body.is_primary_contact !== undefined && body.status !== "inactive") {
        const wantsPrimary = body.is_primary_contact === true;
        if (wantsPrimary) {
          await pg.query(
            `UPDATE vendor_contacts SET is_primary_contact = FALSE, updated_at = NOW()
              WHERE organization_id = $1 AND vendor_id = $2 AND is_primary_contact AND id <> $3`,
            [organizationId, vendorId, contactId]
          );
        }
        push("is_primary_contact", wantsPrimary);
      }

      if (patch.length === 0) {
        res.status(400).json({ error: "no_fields_to_update" });
        return;
      }

      const updated = await pg.query<VendorContactRow>(
        `UPDATE vendor_contacts
            SET ${patch.join(", ")}, updated_at = NOW()
          WHERE id = $1 AND organization_id = $2 AND vendor_id = $3
          RETURNING ${CONTACT_SELECT}`,
        params
      );

      writeAuditEvent({
        organizationId,
        actorUserId: userOf(req),
        eventType: "vendor_contact.updated",
        resourceType: "vendor",
        resourceId: vendorId,
        payload: { contact_id: contactId, fields: Object.keys(body) },
        ipAddress: req.ip ?? null,
      });

      res.status(200).json({ contact: updated.rows[0] });
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        res.status(409).json({
          error: "contact_already_exists",
          message: "This supplier already has a contact with that email address.",
        });
        return;
      }
      logger.error({ event: "vendor_contact_update_failed", organizationId, err }, "Contact update failed");
      res.status(500).json({ error: "vendor_contact_update_failed" });
    }
  })
);

/* =========================================================
   DELETE /api/vendors/:id/contacts/:contactId

   Only a contact that has never been used. Anything else deactivates.
   ========================================================= */

router.delete(
  "/vendors/:id/contacts/:contactId",
  ...GUARDS,
  asTenant(async (req: Request, res: Response) => {
    const organizationId = orgOf(req);
    if (!organizationId) {
      res.status(403).json({ error: "organization_context_missing" });
      return;
    }
    const vendorId = String(req.params["id"] ?? "");
    const contactId = String(req.params["contactId"] ?? "");

    try {
      if (!(await ownVendor(organizationId, vendorId))) {
        res.status(404).json({ error: "vendor_not_found" });
        return;
      }
      const existing = await resolveVendorContact(organizationId, vendorId, contactId);
      if (!existing) {
        res.status(404).json({ error: "contact_not_found" });
        return;
      }

      // The FK is ON DELETE SET NULL, so the database would happily sever the
      // link and leave an invite pointing at nobody. Refusing here is the
      // product decision: a contact who has been sent a questionnaire is part
      // of the record of that questionnaire.
      const referenced = await pg.query<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM vendor_engagement_invites
          WHERE organization_id = $1 AND contact_id = $2`,
        [organizationId, contactId]
      );
      if (Number(referenced.rows[0]?.n ?? "0") > 0) {
        res.status(409).json({
          error: "contact_in_use",
          message:
            "This contact has been sent a questionnaire and is part of that record. " +
            "Mark them inactive instead.",
        });
        return;
      }

      await pg.query(
        `DELETE FROM vendor_contacts WHERE id = $1 AND organization_id = $2 AND vendor_id = $3`,
        [contactId, organizationId, vendorId]
      );

      writeAuditEvent({
        organizationId,
        actorUserId: userOf(req),
        eventType: "vendor_contact.deleted",
        resourceType: "vendor",
        resourceId: vendorId,
        payload: { contact_id: contactId, email: existing.email },
        ipAddress: req.ip ?? null,
      });

      res.status(200).json({ ok: true });
    } catch (err) {
      logger.error({ event: "vendor_contact_delete_failed", organizationId, err }, "Contact delete failed");
      res.status(500).json({ error: "vendor_contact_delete_failed" });
    }
  })
);

export default router;
