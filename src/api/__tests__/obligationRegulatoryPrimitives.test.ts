import { describe, it, expect } from "vitest";
import {
  validateObligationCreate,
  validateObligationPatch,
  validateObligationMappingCreate
} from "../lib/obligationValidation.js";

const VALID_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const VALID_UUID_2 = "b2c3d4e5-f6a7-8901-bcde-f12345678901";

// ================================================================
// validateObligationCreate — body shape
// ================================================================

describe("validateObligationCreate — body shape", () => {
  it("rejects null body", () => {
    const r = validateObligationCreate(null);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects string body", () => {
    const r = validateObligationCreate("HIPAA");
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects array body", () => {
    const r = validateObligationCreate([]);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });
});

// ================================================================
// validateObligationCreate — title
// ================================================================

describe("validateObligationCreate — title", () => {
  it("rejects missing title", () => {
    const r = validateObligationCreate({ source_regulation: "HIPAA" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("title_required");
  });

  it("rejects empty title", () => {
    const r = validateObligationCreate({ title: "" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("title_required");
  });

  it("rejects whitespace-only title", () => {
    const r = validateObligationCreate({ title: "   " });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("title_required");
  });

  it("rejects title exceeding 500 characters", () => {
    const r = validateObligationCreate({ title: "x".repeat(501) });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("title_too_long");
  });

  it("accepts title of exactly 500 characters", () => {
    const r = validateObligationCreate({ title: "x".repeat(500) });
    expect("input" in r).toBe(true);
  });

  it("trims title whitespace", () => {
    const r = validateObligationCreate({ title: "  HIPAA Access Control  " });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.title).toBe("HIPAA Access Control");
  });
});

// ================================================================
// validateObligationCreate — status
// ================================================================

describe("validateObligationCreate — status", () => {
  it("defaults to active when omitted", () => {
    const r = validateObligationCreate({ title: "GDPR Art. 17" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.status).toBe("active");
  });

  it("accepts status=active", () => {
    const r = validateObligationCreate({ title: "T", status: "active" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.status).toBe("active");
  });

  it("accepts status=waived", () => {
    const r = validateObligationCreate({ title: "T", status: "waived" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.status).toBe("waived");
  });

  it("accepts status=not_applicable", () => {
    const r = validateObligationCreate({ title: "T", status: "not_applicable" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.status).toBe("not_applicable");
  });

  it("rejects unknown status", () => {
    const r = validateObligationCreate({ title: "T", status: "pending" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_status");
  });
});

// ================================================================
// validateObligationCreate — priority
// ================================================================

describe("validateObligationCreate — priority", () => {
  it("accepts null priority", () => {
    const r = validateObligationCreate({ title: "T", priority: null });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.priority).toBeNull();
  });

  it("accepts valid priorities", () => {
    for (const p of ["immediate", "near_term", "planned", "watch"]) {
      const r = validateObligationCreate({ title: "T", priority: p });
      expect("input" in r).toBe(true);
      if ("input" in r) expect(r.input.priority).toBe(p);
    }
  });

  it("rejects invalid priority", () => {
    const r = validateObligationCreate({ title: "T", priority: "urgent" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_priority");
  });
});

// ================================================================
// validateObligationCreate — domain
// ================================================================

describe("validateObligationCreate — domain", () => {
  it("accepts null domain", () => {
    const r = validateObligationCreate({ title: "T", domain: null });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.domain).toBeNull();
  });

  it("accepts known domain values", () => {
    const domains = [
      "Access Management",
      "Vendor Risk",
      "AI Governance",
      "Regulatory",
      "Vulnerability",
      "Resilience",
      "General"
    ];
    for (const d of domains) {
      const r = validateObligationCreate({ title: "T", domain: d });
      expect("input" in r).toBe(true);
      if ("input" in r) expect(r.input.domain).toBe(d);
    }
  });

  it("rejects unknown domain", () => {
    const r = validateObligationCreate({ title: "T", domain: "FinancialRisk" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_domain");
  });
});

// ================================================================
// validateObligationCreate — due_date
// ================================================================

describe("validateObligationCreate — due_date", () => {
  it("accepts null due_date", () => {
    const r = validateObligationCreate({ title: "T", due_date: null });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.due_date).toBeNull();
  });

  it("accepts valid YYYY-MM-DD date", () => {
    const r = validateObligationCreate({ title: "T", due_date: "2026-12-31" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.due_date).toBe("2026-12-31");
  });

  it("rejects non-date string", () => {
    const r = validateObligationCreate({ title: "T", due_date: "Q4 2026" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_due_date");
  });

  it("rejects date with wrong format", () => {
    const r = validateObligationCreate({ title: "T", due_date: "31-12-2026" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_due_date");
  });
});

// ================================================================
// validateObligationCreate — owner_user_id
// ================================================================

describe("validateObligationCreate — owner_user_id", () => {
  it("accepts null owner_user_id", () => {
    const r = validateObligationCreate({ title: "T", owner_user_id: null });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.owner_user_id).toBeNull();
  });

  it("accepts valid UUID", () => {
    const r = validateObligationCreate({ title: "T", owner_user_id: VALID_UUID });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.owner_user_id).toBe(VALID_UUID);
  });

  it("rejects non-UUID string", () => {
    const r = validateObligationCreate({ title: "T", owner_user_id: "not-a-uuid" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("owner_user_id_must_be_uuid_or_null");
  });
});

// ================================================================
// validateObligationCreate — optional string fields
// ================================================================

describe("validateObligationCreate — optional string fields", () => {
  it("accepts all optional fields populated", () => {
    const r = validateObligationCreate({
      title: "HIPAA §164.312",
      description: "Access control requirement",
      source_regulation: "HIPAA",
      jurisdiction: "US",
      domain: "Regulatory",
      status: "active",
      priority: "immediate",
      due_date: "2026-12-31",
      owner_user_id: VALID_UUID,
      notes: "Review with legal"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.title).toBe("HIPAA §164.312");
      expect(r.input.description).toBe("Access control requirement");
      expect(r.input.source_regulation).toBe("HIPAA");
      expect(r.input.jurisdiction).toBe("US");
      expect(r.input.domain).toBe("Regulatory");
      expect(r.input.status).toBe("active");
      expect(r.input.priority).toBe("immediate");
      expect(r.input.due_date).toBe("2026-12-31");
      expect(r.input.owner_user_id).toBe(VALID_UUID);
      expect(r.input.notes).toBe("Review with legal");
    }
  });

  it("returns null for absent optional strings", () => {
    const r = validateObligationCreate({ title: "GDPR Art. 5" });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.description).toBeNull();
      expect(r.input.source_regulation).toBeNull();
      expect(r.input.jurisdiction).toBeNull();
      expect(r.input.domain).toBeNull();
      expect(r.input.priority).toBeNull();
      expect(r.input.due_date).toBeNull();
      expect(r.input.owner_user_id).toBeNull();
      expect(r.input.notes).toBeNull();
    }
  });

  it("ignores extra fields", () => {
    const r = validateObligationCreate({ title: "T", extra: "ignored" });
    expect("input" in r).toBe(true);
  });
});

// ================================================================
// validateObligationPatch — body shape
// ================================================================

describe("validateObligationPatch — body shape", () => {
  it("rejects null body", () => {
    const r = validateObligationPatch(null);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects empty body", () => {
    const r = validateObligationPatch({});
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("no_updateable_fields");
  });
});

// ================================================================
// validateObligationPatch — title
// ================================================================

describe("validateObligationPatch — title", () => {
  it("rejects empty title on patch", () => {
    const r = validateObligationPatch({ title: "" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("title_must_be_non_empty_string");
  });

  it("rejects title too long on patch", () => {
    const r = validateObligationPatch({ title: "x".repeat(501) });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("title_too_long");
  });

  it("accepts valid title on patch", () => {
    const r = validateObligationPatch({ title: "Updated Title" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.title).toBe("Updated Title");
  });
});

// ================================================================
// validateObligationPatch — status and priority
// ================================================================

describe("validateObligationPatch — status", () => {
  it("rejects invalid status", () => {
    const r = validateObligationPatch({ status: "archived" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_status");
  });

  it("accepts status=waived", () => {
    const r = validateObligationPatch({ status: "waived" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.status).toBe("waived");
  });
});

describe("validateObligationPatch — priority", () => {
  it("accepts null priority to clear it", () => {
    const r = validateObligationPatch({ priority: null });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.priority).toBeNull();
  });

  it("rejects invalid priority", () => {
    const r = validateObligationPatch({ priority: "high" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_priority");
  });
});

// ================================================================
// validateObligationPatch — domain and due_date
// ================================================================

describe("validateObligationPatch — domain", () => {
  it("accepts null domain to clear it", () => {
    const r = validateObligationPatch({ domain: null });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.domain).toBeNull();
  });

  it("rejects unknown domain", () => {
    const r = validateObligationPatch({ domain: "Unknown" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_domain");
  });

  it("accepts known domain", () => {
    const r = validateObligationPatch({ domain: "Regulatory" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.domain).toBe("Regulatory");
  });
});

describe("validateObligationPatch — due_date", () => {
  it("accepts null due_date to clear it", () => {
    const r = validateObligationPatch({ due_date: null });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.due_date).toBeNull();
  });

  it("rejects invalid date format", () => {
    const r = validateObligationPatch({ due_date: "next-quarter" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("invalid_due_date");
  });

  it("accepts valid date", () => {
    const r = validateObligationPatch({ due_date: "2027-03-31" });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.due_date).toBe("2027-03-31");
  });
});

// ================================================================
// validateObligationPatch — owner_user_id
// ================================================================

describe("validateObligationPatch — owner_user_id", () => {
  it("accepts null to clear owner", () => {
    const r = validateObligationPatch({ owner_user_id: null });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.owner_user_id).toBeNull();
  });

  it("rejects non-UUID owner_user_id", () => {
    const r = validateObligationPatch({ owner_user_id: "not-a-uuid" });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("owner_user_id_must_be_uuid_or_null");
  });

  it("accepts valid UUID owner", () => {
    const r = validateObligationPatch({ owner_user_id: VALID_UUID });
    expect("input" in r).toBe(true);
    if ("input" in r) expect(r.input.owner_user_id).toBe(VALID_UUID);
  });
});

// ================================================================
// validateObligationPatch — multi-field partial update
// ================================================================

describe("validateObligationPatch — multi-field partial update", () => {
  it("accepts a valid multi-field patch", () => {
    const r = validateObligationPatch({
      status: "waived",
      priority: "watch",
      notes: "Accepted risk — low exposure"
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.status).toBe("waived");
      expect(r.input.priority).toBe("watch");
      expect(r.input.notes).toBe("Accepted risk — low exposure");
      // Fields not provided should not appear on the input object
      expect("title" in r.input).toBe(false);
      expect("domain" in r.input).toBe(false);
    }
  });
});

// ================================================================
// validateObligationMappingCreate — body shape
// ================================================================

describe("validateObligationMappingCreate — body shape", () => {
  it("rejects null body", () => {
    const r = validateObligationMappingCreate(null);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });

  it("rejects array body", () => {
    const r = validateObligationMappingCreate([]);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("request_body_required");
  });
});

// ================================================================
// validateObligationMappingCreate — obligation_id
// ================================================================

describe("validateObligationMappingCreate — obligation_id", () => {
  it("rejects missing obligation_id", () => {
    const r = validateObligationMappingCreate({ requirement_id: VALID_UUID });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("obligation_id_required");
  });

  it("rejects non-UUID obligation_id", () => {
    const r = validateObligationMappingCreate({
      obligation_id: "not-a-uuid",
      requirement_id: VALID_UUID
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("obligation_id_must_be_uuid");
  });

  it("rejects empty obligation_id", () => {
    const r = validateObligationMappingCreate({
      obligation_id: "",
      requirement_id: VALID_UUID
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("obligation_id_required");
  });
});

// ================================================================
// validateObligationMappingCreate — requirement_id
// ================================================================

describe("validateObligationMappingCreate — requirement_id", () => {
  it("rejects missing requirement_id", () => {
    const r = validateObligationMappingCreate({ obligation_id: VALID_UUID });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("requirement_id_required");
  });

  it("rejects non-UUID requirement_id", () => {
    const r = validateObligationMappingCreate({
      obligation_id: VALID_UUID,
      requirement_id: "also-not-a-uuid"
    });
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toBe("requirement_id_must_be_uuid");
  });
});

// ================================================================
// validateObligationMappingCreate — valid input
// ================================================================

describe("validateObligationMappingCreate — valid input", () => {
  it("accepts both valid UUIDs", () => {
    const r = validateObligationMappingCreate({
      obligation_id: VALID_UUID,
      requirement_id: VALID_UUID_2
    });
    expect("input" in r).toBe(true);
    if ("input" in r) {
      expect(r.input.obligation_id).toBe(VALID_UUID);
      expect(r.input.requirement_id).toBe(VALID_UUID_2);
    }
  });

  it("ignores extra fields", () => {
    const r = validateObligationMappingCreate({
      obligation_id: VALID_UUID,
      requirement_id: VALID_UUID_2,
      extra: "ignored"
    });
    expect("input" in r).toBe(true);
  });
});
