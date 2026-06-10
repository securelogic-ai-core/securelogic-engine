/**
 * legalConsent.test.ts — unit tests for the legal-consent helper library.
 *
 * These exercise the pure query-building / set-logic of the helpers against a
 * fake Queryable (a vi.fn-backed { query }). Real idempotency is enforced by the
 * `legal_consents` UNIQUE (user_id, document_type, document_version) constraint
 * + ON CONFLICT DO NOTHING at the DB layer; here we assert the helper emits that
 * clause and the correct parameters.
 */

import { describe, it, expect, vi } from "vitest";
import {
  recordConsent,
  recordAllCurrentConsents,
  getMissingConsents,
  CURRENT_VERSIONS,
  DOCUMENT_TYPES,
  type Queryable,
} from "../lib/legalConsent.js";

function makeClient(rows: any[] = []) {
  const query = vi.fn(async () => ({ rows }));
  return { client: { query } as unknown as Queryable, query };
}

const USER = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";

describe("recordConsent", () => {
  it("inserts a row with the correct values", async () => {
    const { client, query } = makeClient();
    await recordConsent(client, {
      userId: USER,
      organizationId: ORG,
      documentType: "terms_of_service",
      documentVersion: "1.0",
      consentMethod: "signup_checkbox",
      ipAddress: "203.0.113.7",
      userAgent: "vitest-agent",
    });
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0]!;
    expect(sql).toMatch(/INSERT INTO legal_consents/);
    expect(sql).toMatch(/ON CONFLICT \(user_id, document_type, document_version\) DO NOTHING/);
    expect(params).toEqual([
      USER,
      ORG,
      "terms_of_service",
      "1.0",
      "signup_checkbox",
      "203.0.113.7",
      "vitest-agent",
    ]);
  });

  it("coerces missing ip/userAgent to null", async () => {
    const { client, query } = makeClient();
    await recordConsent(client, {
      userId: USER,
      organizationId: ORG,
      documentType: "privacy_policy",
      documentVersion: "1.0",
      consentMethod: "admin_recorded",
    });
    const [, params] = query.mock.calls[0]!;
    expect(params![5]).toBeNull();
    expect(params![6]).toBeNull();
  });

  it("is idempotent at the SQL layer — repeat calls each carry ON CONFLICT DO NOTHING", async () => {
    const { client, query } = makeClient();
    const base = {
      userId: USER,
      organizationId: ORG,
      documentType: "terms_of_service" as const,
      documentVersion: "1.0",
      consentMethod: "signup_checkbox" as const,
    };
    await recordConsent(client, base);
    await recordConsent(client, base);
    expect(query).toHaveBeenCalledTimes(2);
    for (const call of query.mock.calls) {
      expect(call[0]).toMatch(/ON CONFLICT \(user_id, document_type, document_version\) DO NOTHING/);
    }
  });
});

describe("recordAllCurrentConsents", () => {
  it("inserts one row per document type at the current version", async () => {
    const { client, query } = makeClient();
    await recordAllCurrentConsents(client, {
      userId: USER,
      organizationId: ORG,
      consentMethod: "team_invite_accept",
    });
    expect(query).toHaveBeenCalledTimes(DOCUMENT_TYPES.length);
    const insertedTypes = query.mock.calls.map((c) => c[1]![2]);
    expect(insertedTypes).toEqual([...DOCUMENT_TYPES]);
    for (const call of query.mock.calls) {
      const params = call[1]!;
      const docType = params[2] as keyof typeof CURRENT_VERSIONS;
      expect(params[3]).toBe(CURRENT_VERSIONS[docType]); // version
      expect(params[4]).toBe("team_invite_accept"); // method
    }
  });
});

describe("getMissingConsents", () => {
  it("returns an empty array when all current consents are present", async () => {
    const rows = DOCUMENT_TYPES.map((d) => ({ document_type: d, document_version: CURRENT_VERSIONS[d] }));
    const { client } = makeClient(rows);
    const missing = await getMissingConsents(client, USER);
    expect(missing).toEqual([]);
  });

  it("returns the document types the user has not consented to", async () => {
    const rows = [
      { document_type: "terms_of_service", document_version: CURRENT_VERSIONS.terms_of_service },
    ];
    const { client } = makeClient(rows);
    const missing = await getMissingConsents(client, USER);
    expect(missing).toEqual(["privacy_policy", "ai_transparency_policy"]);
  });

  it("returns all document types when the user has no consents", async () => {
    const { client } = makeClient([]);
    const missing = await getMissingConsents(client, USER);
    expect(missing).toEqual([...DOCUMENT_TYPES]);
  });

  it("treats a consent at an older version as missing", async () => {
    const rows = DOCUMENT_TYPES.map((d) => ({ document_type: d, document_version: CURRENT_VERSIONS[d] }));
    // Downgrade the terms_of_service consent to a stale version.
    rows[0] = { document_type: "terms_of_service", document_version: "0.9" };
    const { client } = makeClient(rows);
    const missing = await getMissingConsents(client, USER);
    expect(missing).toEqual(["terms_of_service"]);
  });
});
