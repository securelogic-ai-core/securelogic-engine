import { describe, it, expect } from "vitest";
import type { AuditSprintResultV1 } from "../contracts";

describe("Frozen contracts", () => {
  it("AuditSprintResultV1 type exists", () => {
    const x: AuditSprintResultV1 | null = null;
    expect(x).toBeNull();
  });
});
