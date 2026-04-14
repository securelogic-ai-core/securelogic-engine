import { describe, it, expect } from "vitest";
import { validateActionCreate } from "../lib/actionValidation.js";

// ----------------------------------------------------------------
// validateActionCreate
// ----------------------------------------------------------------

describe("validateActionCreate — required fields", () => {
  it("rejects null body", () => {
    const result = validateActionCreate(null);
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toBe("request_body_required");
  });

  it("rejects non-object body", () => {
    const result = validateActionCreate("string");
    expect("error" in result).toBe(true);
  });

  it("rejects array body", () => {
    const result = validateActionCreate([]);
    expect("error" in result).toBe(true);
  });

  it("rejects missing title", () => {
    const result = validateActionCreate({
      source_type: "manual",
      priority: "planned"
    });
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toBe("title_required");
  });

  it("rejects empty title", () => {
    const result = validateActionCreate({
      title: "   ",
      source_type: "manual",
      priority: "planned"
    });
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toBe("title_required");
  });

  it("rejects missing source_type", () => {
    const result = validateActionCreate({
      title: "Fix it",
      priority: "planned"
    });
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toBe("source_type_required");
  });

  it("rejects invalid source_type", () => {
    const result = validateActionCreate({
      title: "Fix it",
      source_type: "newsletter",
      priority: "planned"
    });
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toBe("invalid_source_type");
  });

  it("rejects missing priority", () => {
    const result = validateActionCreate({
      title: "Fix it",
      source_type: "manual"
    });
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toBe("priority_required");
  });

  it("rejects invalid priority", () => {
    const result = validateActionCreate({
      title: "Fix it",
      source_type: "manual",
      priority: "urgent"
    });
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toBe("invalid_priority");
  });
});

describe("validateActionCreate — optional field validation", () => {
  const valid = {
    title: "Remediate control gap",
    source_type: "assessment",
    priority: "near_term"
  };

  it("accepts a valid uuid source_id", () => {
    const result = validateActionCreate({
      ...valid,
      source_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
    });
    expect("input" in result).toBe(true);
  });

  it("rejects a non-uuid source_id", () => {
    const result = validateActionCreate({ ...valid, source_id: "not-a-uuid" });
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toBe("source_id_must_be_uuid");
  });

  it("accepts null source_id", () => {
    const result = validateActionCreate({ ...valid, source_id: null });
    expect("input" in result).toBe(true);
  });

  it("accepts a valid uuid owner_user_id", () => {
    const result = validateActionCreate({
      ...valid,
      owner_user_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
    });
    expect("input" in result).toBe(true);
  });

  it("rejects non-uuid owner_user_id", () => {
    const result = validateActionCreate({
      ...valid,
      owner_user_id: "not-valid"
    });
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toBe("owner_user_id_must_be_uuid");
  });

  it("accepts a valid YYYY-MM-DD due_date", () => {
    const result = validateActionCreate({ ...valid, due_date: "2026-06-30" });
    expect("input" in result).toBe(true);
  });

  it("rejects an invalid due_date format", () => {
    const result = validateActionCreate({ ...valid, due_date: "30-06-2026" });
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toBe("due_date_must_be_yyyy_mm_dd");
  });

  it("accepts null due_date", () => {
    const result = validateActionCreate({ ...valid, due_date: null });
    expect("input" in result).toBe(true);
  });
});

describe("validateActionCreate — valid minimal input", () => {
  it("returns input for the minimum required fields", () => {
    const result = validateActionCreate({
      title: "Review vendor contract",
      source_type: "manual",
      priority: "planned"
    });

    expect("input" in result).toBe(true);
    if ("input" in result) {
      expect(result.input.title).toBe("Review vendor contract");
      expect(result.input.source_type).toBe("manual");
      expect(result.input.priority).toBe("planned");
      expect(result.input.description).toBeNull();
      expect(result.input.source_id).toBeNull();
      expect(result.input.due_date).toBeNull();
      expect(result.input.owner_user_id).toBeNull();
    }
  });

  it("trims whitespace from title", () => {
    const result = validateActionCreate({
      title: "  Review  ",
      source_type: "finding",
      priority: "immediate"
    });
    expect("input" in result).toBe(true);
    if ("input" in result) {
      expect(result.input.title).toBe("Review");
    }
  });
});

describe("validateActionCreate — all valid source types", () => {
  const base = { title: "Test", priority: "watch" };

  it.each(["assessment", "finding", "signal", "manual", "risk"])(
    "accepts source_type=%s",
    (source_type) => {
      const result = validateActionCreate({ ...base, source_type });
      expect("input" in result).toBe(true);
    }
  );
});

describe("validateActionCreate — risk source_type linkage", () => {
  it("accepts source_type=risk with a UUID source_id", () => {
    const result = validateActionCreate({
      title: "Remediate critical vendor risk",
      priority: "immediate",
      source_type: "risk",
      source_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
    });
    expect("input" in result).toBe(true);
    if ("input" in result) {
      expect(result.input.source_type).toBe("risk");
      expect(result.input.source_id).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    }
  });

  it("accepts source_type=risk without source_id (source_id optional)", () => {
    const result = validateActionCreate({
      title: "Remediate risk",
      priority: "near_term",
      source_type: "risk"
    });
    expect("input" in result).toBe(true);
    if ("input" in result) expect(result.input.source_type).toBe("risk");
  });
});

describe("validateActionCreate — all valid priorities", () => {
  const base = { title: "Test", source_type: "manual" };

  it.each(["immediate", "near_term", "planned", "watch"])(
    "accepts priority=%s",
    (priority) => {
      const result = validateActionCreate({ ...base, priority });
      expect("input" in result).toBe(true);
    }
  );
});
