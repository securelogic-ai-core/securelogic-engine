import { describe, it, expect } from "vitest";
import { DEFAULT_ENGINE_MODE } from "../EngineMode.js";

describe("Engine mode safety", () => {
  it("must default to V2 in production", () => {
    expect(DEFAULT_ENGINE_MODE).toBe("V2");
  });
});
