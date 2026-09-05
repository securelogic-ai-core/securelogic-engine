/**
 * vendorContacts.test.ts — VA-C1.
 *
 * A vendor contact is PII for a person who has no account with us, attached to
 * one supplier of one customer. Two boundaries therefore have to hold, and only
 * one of them gets any help from the platform's usual machinery:
 *
 *   org A vs org B          — org predicate + RLS (proved here anyway)
 *   Alpha vs Beta, same org — NOTHING but the vendor_id on every query
 *
 * The second is the one that matters. Both suppliers belong to the same
 * customer, every row carries the same organization_id, and the contact ids are
 * all in the URL.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { Pool } from "pg";

import { bootstrapTestDb, seedVendor, type TestDbSeed } from "./testDb.js";
import { buildRoutes } from "../../src/api/routes/index.js";

let seed: TestDbSeed;
let pool: Pool;
let app: express.Express;

let alphaVendor: string;
let betaVendor: string;
let orgBVendor: string;
let betaContactId: string;

const list = (key: string, vendorId: string) =>
  request(app).get(`/api/vendors/${vendorId}/contacts`).set("X-Api-Key", key);
const create = (key: string, vendorId: string, body: Record<string, unknown>) =>
  request(app).post(`/api/vendors/${vendorId}/contacts`).set("X-Api-Key", key).send(body);
const patch = (key: string, vendorId: string, id: string, body: Record<string, unknown>) =>
  request(app).patch(`/api/vendors/${vendorId}/contacts/${id}`).set("X-Api-Key", key).send(body);
const remove = (key: string, vendorId: string, id: string) =>
  request(app).delete(`/api/vendors/${vendorId}/contacts/${id}`).set("X-Api-Key", key);

beforeAll(async () => {
  seed = await bootstrapTestDb();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set.");
  process.env.DATABASE_URL = url;
  process.env.SECURELOGIC_VENDOR_ASSURANCE_ENABLED = "true";
  pool = new Pool({ connectionString: url, ssl: false });

  alphaVendor = await seedVendor(pool, seed.orgA.id, { name: "Alpha Supplies" });
  betaVendor = await seedVendor(pool, seed.orgA.id, { name: "Beta Systems" });
  orgBVendor = await seedVendor(pool, seed.orgB.id, { name: "Org B Supplier" });

  app = express();
  app.use(express.json());
  app.use(buildRoutes({ isDev: false, publicApiDisabled: false }));

  const betaContact = await create(seed.orgA.apiKey, betaVendor, {
    full_name: "Beta Secret Person",
    email: "beta-secret@beta.example",
    contact_role: "security",
  });
  expect(betaContact.status).toBe(201);
  betaContactId = betaContact.body.contact.id;
}, 180_000);

afterAll(async () => {
  delete process.env.SECURELOGIC_VENDOR_ASSURANCE_ENABLED;
  await pool?.end();
});

describe("VA-C1 — the supplier has a contact directory", () => {
  it("creates a contact and returns it without inventing anything", async () => {
    const res = await create(seed.orgA.apiKey, alphaVendor, {
      full_name: "Jane Alpha",
      email: "jane@alpha.example",
      title: "Head of Security",
      contact_role: "security",
      is_primary_contact: true,
    });
    expect(res.status).toBe(201);
    expect(res.body.contact).toMatchObject({
      full_name: "Jane Alpha",
      email: "jane@alpha.example",
      contact_role: "security",
      is_primary_contact: true,
      status: "active",
    });
  });

  it("refuses a second contact at the same address, case-insensitively", async () => {
    const res = await create(seed.orgA.apiKey, alphaVendor, {
      full_name: "Jane Again",
      email: "JANE@alpha.example",
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("contact_already_exists");
  });

  it("WA-2: the refusal NAMES the contact holding the address, and its status", async () => {
    // Before WA-2 this said only "this supplier already has a contact with that
    // email address". That is unresolvable when the holder is INACTIVE: every
    // add surface lists active contacts only, so the customer is refused by a
    // row they cannot see and cannot reach. Reproduced on staging.
    const res = await create(seed.orgA.apiKey, alphaVendor, {
      full_name: "Jane Again",
      email: "jane@alpha.example",
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("contact_already_exists");
    expect(res.body.contact_id).toBeTruthy();
    expect(res.body.contact_status).toBe("active");
    expect(res.body.contact_name).toBe("Jane Alpha");
  });

  it("WA-2: an INACTIVE holder is named as inactive, and the message says to reactivate", async () => {
    const vendorId = await seedVendor(pool, seed.orgA.id, { name: "Epsilon Logistics" });
    const made = await create(seed.orgA.apiKey, vendorId, {
      full_name: "Kim Epsilon",
      email: "kim@epsilon.example",
      is_primary_contact: true,
    });
    expect(made.status).toBe(201);
    const contactId = made.body.contact.id;

    const off = await request(app)
      .patch(`/api/vendors/${vendorId}/contacts/${contactId}`)
      .set("X-Api-Key", seed.orgA.apiKey)
      .send({ status: "inactive" });
    expect(off.status).toBe(200);

    const again = await create(seed.orgA.apiKey, vendorId, {
      full_name: "Kim Epsilon",
      email: "kim@epsilon.example",
    });
    expect(again.status).toBe(409);
    expect(again.body.contact_id).toBe(contactId);
    expect(again.body.contact_status).toBe("inactive");
    // The action that resolves it, named. Never a delete — the row carries the
    // history of everything that person was sent.
    expect(again.body.message).toMatch(/inactive/i);
    expect(again.body.message).toMatch(/[Rr]eactivate/);

    // And the row is untouched by the refused attempt: still there, still
    // inactive, still the same person.
    const rows = await list(seed.orgA.apiKey, vendorId);
    expect(rows.body.contacts).toHaveLength(1);
    expect(rows.body.contacts[0].status).toBe("inactive");
    expect(rows.body.contacts[0].full_name).toBe("Kim Epsilon");
  });

  it("WA-2: the pre-flight refusal still leaves the standing primary standing", async () => {
    // The collision is now caught BEFORE the primary demotion rather than by
    // the unique index after it. That ordering is the whole reason the fix is
    // safe: a JS-level early return placed AFTER the demotion would commit the
    // demotion alongside the refusal (the #866 defect). This pins it.
    const vendorId = await seedVendor(pool, seed.orgA.id, { name: "Zeta Rail" });
    const first = await create(seed.orgA.apiKey, vendorId, {
      full_name: "Ivy Zeta",
      email: "ivy@zeta.example",
      is_primary_contact: true,
    });
    expect(first.status).toBe(201);

    const dup = await create(seed.orgA.apiKey, vendorId, {
      full_name: "Ivy Again",
      email: "IVY@ZETA.EXAMPLE",
      is_primary_contact: true,
    });
    expect(dup.status).toBe(409);

    const rows = await list(seed.orgA.apiKey, vendorId);
    const primaries = rows.body.contacts.filter((c: { is_primary_contact: boolean }) => c.is_primary_contact);
    expect(primaries).toHaveLength(1);
    expect(primaries[0].email).toBe("ivy@zeta.example");
  });

  it("the SAME address at a DIFFERENT supplier is a different person", async () => {
    // One human can work at two of a customer's suppliers, and more to the
    // point: uniqueness must be scoped to the supplier or one vendor's
    // directory could block another's.
    const res = await create(seed.orgA.apiKey, betaVendor, {
      full_name: "Jane Elsewhere",
      email: "jane@alpha.example",
    });
    expect(res.status).toBe(201);
  });

  it("promoting a new primary demotes the old one — never two, never none", async () => {
    const second = await create(seed.orgA.apiKey, alphaVendor, {
      full_name: "Sam Alpha",
      email: "sam@alpha.example",
      is_primary_contact: true,
    });
    expect(second.status).toBe(201);

    const rows = await list(seed.orgA.apiKey, alphaVendor);
    const primaries = rows.body.contacts.filter((c: { is_primary_contact: boolean }) => c.is_primary_contact);
    expect(primaries).toHaveLength(1);
    expect(primaries[0].email).toBe("sam@alpha.example");
  });

  // ── A REFUSED WRITE MUST LEAVE NOTHING BEHIND ──────────────────────────
  //
  // Both write paths demote the standing primary BEFORE the statement that can
  // fail on the duplicate-address index, so a refusal has a half-applied write
  // sitting behind it. Nothing is lost today, but only because of a mechanism
  // neither route states: asTenant commits when the handler RESOLVES (a caught
  // error and a 409 response resolve), and a COMMIT issued on a transaction
  // Postgres already aborted on the 23505 acts as a ROLLBACK.
  //
  // That is load-bearing and invisible. It also does NOT cover a JS-level
  // early return placed after the demotion — the transaction would still be
  // healthy and the demotion would commit alongside the refusal, which is the
  // #866 defect exactly. These pin the customer-visible invariant so the next
  // edit to either handler has to keep it: a refused write changes nothing.

  it("a create refused as a duplicate leaves the standing primary standing", async () => {
    const vendorId = await seedVendor(pool, seed.orgA.id, { name: "Gamma Freight" });
    const first = await create(seed.orgA.apiKey, vendorId, {
      full_name: "Ada Gamma",
      email: "ada@gamma.example",
      is_primary_contact: true,
    });
    expect(first.status).toBe(201);

    const dup = await create(seed.orgA.apiKey, vendorId, {
      full_name: "Ada Again",
      email: "ada@gamma.example",
      is_primary_contact: true,
    });
    expect(dup.status).toBe(409);

    const rows = await list(seed.orgA.apiKey, vendorId);
    const primaries = rows.body.contacts.filter((c: { is_primary_contact: boolean }) => c.is_primary_contact);
    expect(primaries).toHaveLength(1);
    expect(primaries[0].email).toBe("ada@gamma.example");
  });

  it("an edit refused as a duplicate leaves the standing primary standing", async () => {
    const vendorId = await seedVendor(pool, seed.orgA.id, { name: "Delta Haulage" });
    const pat = await create(seed.orgA.apiKey, vendorId, {
      full_name: "Pat Delta",
      email: "pat@delta.example",
      is_primary_contact: true,
    });
    expect(pat.status).toBe(201);
    const rae = await create(seed.orgA.apiKey, vendorId, {
      full_name: "Rae Delta",
      email: "rae@delta.example",
    });
    expect(rae.status).toBe(201);

    // Rae reaches for both the primary flag and Pat's address in one edit.
    const res = await patch(seed.orgA.apiKey, vendorId, rae.body.contact.id, {
      email: "pat@delta.example",
      is_primary_contact: true,
    });
    expect(res.status).toBe(409);

    const rows = await list(seed.orgA.apiKey, vendorId);
    const primaries = rows.body.contacts.filter((c: { is_primary_contact: boolean }) => c.is_primary_contact);
    expect(primaries).toHaveLength(1);
    expect(primaries[0].email).toBe("pat@delta.example");
    // ...and Rae is untouched, not half-edited.
    const raeNow = rows.body.contacts.find((c: { id: string }) => c.id === rae.body.contact.id);
    expect(raeNow.email).toBe("rae@delta.example");
  });

  it("deactivating drops the primary flag rather than leaving a lie standing", async () => {
    const rows = await list(seed.orgA.apiKey, alphaVendor);
    const sam = rows.body.contacts.find((c: { email: string }) => c.email === "sam@alpha.example");
    const res = await patch(seed.orgA.apiKey, alphaVendor, sam.id, { status: "inactive" });
    expect(res.status).toBe(200);
    expect(res.body.contact.status).toBe("inactive");
    expect(res.body.contact.is_primary_contact).toBe(false);
  });

  it("rejects a role outside the vocabulary and a malformed address", async () => {
    expect((await create(seed.orgA.apiKey, alphaVendor, {
      full_name: "X", email: "x@y.example", contact_role: "ceo",
    })).status).toBe(400);
    expect((await create(seed.orgA.apiKey, alphaVendor, {
      full_name: "X", email: "not-an-address",
    })).status).toBe(400);
  });
});

describe("VA-C1 — a contact that has been used cannot be deleted", () => {
  it("deletes a never-used contact", async () => {
    const made = await create(seed.orgA.apiKey, alphaVendor, {
      full_name: "Temp Person",
      email: "temp@alpha.example",
    });
    const res = await remove(seed.orgA.apiKey, alphaVendor, made.body.contact.id);
    expect(res.status).toBe(200);
  });

  it("refuses to delete a contact an invitation was sent to — deactivate instead", async () => {
    const made = await create(seed.orgA.apiKey, alphaVendor, {
      full_name: "Invited Person",
      email: "invited@alpha.example",
    });
    const contactId = made.body.contact.id;

    const eng = await pool.query<{ id: string }>(
      `INSERT INTO vendor_engagements
         (organization_id, vendor_id, engagement_type, status,
          methodology_version, scope_rule_version)
       VALUES ($1, $2, 'initial', 'issued', '1.0.0', '1.0.0') RETURNING id`,
      [seed.orgA.id, alphaVendor]
    );
    await pool.query(
      `INSERT INTO vendor_engagement_invites
         (organization_id, engagement_id, invite_token_hash, contact_email, expires_at, contact_id)
       VALUES ($1, $2, $3, 'invited@alpha.example', NOW() + INTERVAL '30 days', $4)`,
      [seed.orgA.id, eng.rows[0]!.id, `hash-${contactId}`, contactId]
    );

    const res = await remove(seed.orgA.apiKey, alphaVendor, contactId);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("contact_in_use");

    // And the contact is still there to be deactivated.
    const still = await pool.query(`SELECT 1 FROM vendor_contacts WHERE id = $1`, [contactId]);
    expect(still.rowCount).toBe(1);
  });

  it("editing a contact does NOT rewrite the invitation's historical snapshot", async () => {
    const invite = await pool.query<{ id: string; contact_id: string }>(
      `SELECT id, contact_id FROM vendor_engagement_invites
        WHERE organization_id = $1 AND contact_email = 'invited@alpha.example'`,
      [seed.orgA.id]
    );
    const contactId = invite.rows[0]!.contact_id;

    const res = await patch(seed.orgA.apiKey, alphaVendor, contactId, {
      email: "moved-on@alpha.example",
      full_name: "Invited Person (left)",
    });
    expect(res.status).toBe(200);

    const after = await pool.query<{ contact_email: string }>(
      `SELECT contact_email FROM vendor_engagement_invites WHERE id = $1`,
      [invite.rows[0]!.id]
    );
    // Who we mailed, at the address we used. Still true.
    expect(after.rows[0]!.contact_email).toBe("invited@alpha.example");
  });
});

describe("VA-C1 — two suppliers of one customer cannot see each other", () => {
  it("Alpha's contact list never contains Beta's people", async () => {
    const res = await list(seed.orgA.apiKey, alphaVendor);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain("beta-secret@beta.example");
  });

  it("Beta's contact id is not addressable through Alpha's vendor", async () => {
    expect((await patch(seed.orgA.apiKey, alphaVendor, betaContactId, { title: "hijacked" })).status).toBe(404);
    expect((await remove(seed.orgA.apiKey, alphaVendor, betaContactId)).status).toBe(404);

    const untouched = await pool.query<{ title: string | null }>(
      `SELECT title FROM vendor_contacts WHERE id = $1`,
      [betaContactId]
    );
    expect(untouched.rows[0]!.title).toBeNull();
  });

  it("issuing Alpha's engagement to BETA's contact is refused, indistinguishably from unknown", async () => {
    const eng = await pool.query<{ id: string }>(
      `INSERT INTO vendor_engagements
         (organization_id, vendor_id, engagement_type, status,
          methodology_version, scope_rule_version)
       VALUES ($1, $2, 'initial', 'scoped', '1.0.0', '1.0.0') RETURNING id`,
      [seed.orgA.id, alphaVendor]
    );
    const res = await request(app)
      .post(`/api/vendor-engagements/${eng.rows[0]!.id}/issue`)
      .set("X-Api-Key", seed.orgA.apiKey)
      .send({ contact_id: betaContactId });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("contact_not_found");
  });
});

describe("VA-C1 — cross-tenant", () => {
  it("org B cannot list, create, edit or delete org A's supplier contacts", async () => {
    expect((await list(seed.orgB.apiKey, alphaVendor)).status).toBe(404);
    expect((await create(seed.orgB.apiKey, alphaVendor, {
      full_name: "Intruder", email: "intruder@b.example",
    })).status).toBe(404);
    expect((await patch(seed.orgB.apiKey, betaVendor, betaContactId, { title: "x" })).status).toBe(404);
    expect((await remove(seed.orgB.apiKey, betaVendor, betaContactId)).status).toBe(404);
  });

  it("and org B's own directory works — the previous test is not vacuous", async () => {
    const made = await create(seed.orgB.apiKey, orgBVendor, {
      full_name: "B Person",
      email: "person@orgb.example",
    });
    expect(made.status).toBe(201);
    const rows = await list(seed.orgB.apiKey, orgBVendor);
    expect(JSON.stringify(rows.body)).toContain("person@orgb.example");
    expect(JSON.stringify(rows.body)).not.toContain("beta-secret@beta.example");
  });

  it("no api key, no directory", async () => {
    expect((await request(app).get(`/api/vendors/${alphaVendor}/contacts`)).status).toBe(401);
  });
});

describe("VA-C1 — owner ruling: criticality and tier stay separate", () => {
  it("the engagement read carries the ENDURING vendor criticality beside the engagement's own tier", async () => {
    await pool.query(`UPDATE vendors SET criticality = 'critical' WHERE id = $1`, [alphaVendor]);
    const eng = await pool.query<{ id: string }>(
      `INSERT INTO vendor_engagements
         (organization_id, vendor_id, engagement_type, status,
          methodology_version, scope_rule_version, assessment_tier, inherent_rating)
       VALUES ($1, $2, 'periodic', 'draft', '1.0.0', '1.0.0', 'tier_3_moderate', 'Moderate')
       RETURNING id`,
      [seed.orgA.id, alphaVendor]
    );

    const res = await request(app)
      .get(`/api/vendor-engagements/${eng.rows[0]!.id}`)
      .set("X-Api-Key", seed.orgA.apiKey);
    expect(res.status).toBe(200);
    // Both, and different: the supplier is critical to the business while THIS
    // assessment is a moderate-depth periodic review.
    expect(res.body.engagement.vendor_criticality).toBe("critical");
    expect(res.body.engagement.assessment_tier).toBe("tier_3_moderate");
  });

  it("opening a new engagement — intake business_criticality 'critical' and all — does not touch the vendor's criticality", async () => {
    const before = await pool.query<{ criticality: string }>(
      `SELECT criticality FROM vendors WHERE id = $1`,
      [alphaVendor]
    );
    const created = await request(app)
      .post("/api/vendor-engagements")
      .set("X-Api-Key", seed.orgA.apiKey)
      .send({
        vendor_id: alphaVendor,
        engagement_type: "periodic",
        intake: {
          data_sensitivity: "restricted",
          data_volume: "mass",
          access_level: "read_write",
          operational_dependency: "critical",
          recoverability: "weeks",
          business_criticality: "critical",
          regulatory_exposure: "high",
          regulatory_breach_notification: true,
          ai_involvement: "none",
          ai_autonomy: "none",
          hosting_model: "multi_tenant_saas",
          fourth_party_exposure: "high",
          concentration: "single_point_of_failure",
        },
      });
    expect([200, 201]).toContain(created.status);

    const after = await pool.query<{ criticality: string }>(
      `SELECT criticality FROM vendors WHERE id = $1`,
      [alphaVendor]
    );
    expect(after.rows[0]!.criticality).toBe(before.rows[0]!.criticality);
    expect(after.rows[0]!.criticality).toBe("critical");
  });
});
