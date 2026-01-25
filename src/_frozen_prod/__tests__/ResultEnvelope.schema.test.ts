import { describe, it, expect } from "vitest";

import { describe, it, expect } from "vitest";
import { validateResultEnvelope } from "../validation/validateResultEnvelope";

describe("ResultEnvelopeV1 schema", () => {
  it("rejects invalid envelope", () => {
    expect(() => validateResultEnvelope({})).toThrow();
  });
});
