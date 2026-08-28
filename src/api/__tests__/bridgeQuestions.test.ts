/**
 * bridgeQuestions.test.ts — the content-addressed identity of a questionnaire
 * (VA-Q1 P2, ADR-0013 R3) and the requirement→domain bridge.
 */
import { describe, it, expect } from "vitest";
import { questionSetHash, type QuestionSetItem } from "../lib/questionnaire/bridgeQuestions.js";
import { domainForScopeTags } from "../lib/questionnaire/questionContent.js";

const h = (n: number) => n.toString(16).padStart(64, "0");
const items: QuestionSetItem[] = [
  { content_hash: h(1), depth: "full", mandatory: true, requirement_id: "r-1" },
  { content_hash: h(2), depth: "confirm", mandatory: false, requirement_id: "r-2" },
  { content_hash: h(3), depth: "full", mandatory: true, requirement_id: "r-3" },
];

describe("questionSetHash", () => {
  it("is 64 hex chars and identical for the same items in any input order", () => {
    const a = questionSetHash(items);
    const b = questionSetHash([items[2]!, items[0]!, items[1]!]);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(b).toBe(a);
  });

  it("changes when content, depth or mandatory changes — and when an item is added or removed", () => {
    const a = questionSetHash(items);
    expect(questionSetHash([{ ...items[0]!, content_hash: h(9) }, items[1]!, items[2]!])).not.toBe(a);
    expect(questionSetHash([{ ...items[0]!, depth: "attest" }, items[1]!, items[2]!])).not.toBe(a);
    expect(questionSetHash([{ ...items[1]!, mandatory: true }, items[0]!, items[2]!])).not.toBe(a);
    expect(questionSetHash(items.slice(0, 2))).not.toBe(a);
  });

  it("does NOT depend on requirement display labels — only on what is asked and how", () => {
    // The same content under a different requirement id hashes the same when
    // the set is otherwise identical; requirement_id is only a tiebreak.
    const a = questionSetHash([{ content_hash: h(1), depth: "full", mandatory: true, requirement_id: "x" }]);
    const b = questionSetHash([{ content_hash: h(1), depth: "full", mandatory: true, requirement_id: "y" }]);
    expect(a).toBe(b);
  });

  it("an empty set has a defined, stable hash", () => {
    expect(questionSetHash([])).toBe(questionSetHash([]));
  });
});

describe("domainForScopeTags — VA-Q0 §5 bridge", () => {
  it("security is the floor: untagged or core-only requirements are security questions", () => {
    expect(domainForScopeTags([])).toBe("security");
    expect(domainForScopeTags(["core", "access-control", "logging"])).toBe("security");
  });

  it("the most specific non-security domain wins", () => {
    expect(domainForScopeTags(["access-control", "privacy"])).toBe("privacy");
    expect(domainForScopeTags(["core", "supply-chain"])).toBe("nth_party");
    expect(domainForScopeTags(["resilience", "business-continuity"])).toBe("resilience");
    expect(domainForScopeTags(["privacy", "ai-governance"])).toBe("ai");
  });

  it("ignores tags outside the vocabulary", () => {
    expect(domainForScopeTags(["not-a-tag"])).toBe("security");
  });
});
