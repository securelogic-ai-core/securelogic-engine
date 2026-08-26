/**
 * verdictPromptVersionGuard.test.ts — the build-breaking guard that keeps the
 * verdict cache honest.
 *
 * The cache key includes `prompt_version`, and cached verdicts are replayed
 * verbatim. So if the prompt template, the model, or the response contract
 * changes WITHOUT a version bump, every stale verdict silently keeps being
 * served as if it were the current model's answer — a correctness failure that
 * produces no error anywhere and would be nearly impossible to notice.
 *
 * A comment saying "remember to bump this" is not a control. This test hashes
 * the parts of llmControlMatcher.ts that determine the answer and pins the
 * digest to the recorded prompt version. Change either, and this fails with
 * instructions rather than shipping a poisoned cache.
 *
 * WHEN THIS FAILS: bump LLM_CONTROL_MATCHER_PROMPT_VERSION, then update
 * EXPECTED_SOURCE_DIGEST below to the digest the failure message prints. Both
 * edits belong in the same commit as the prompt change.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

// Source-shape test, deliberately with NO runtime import of llmControlMatcher:
// that module now reaches infra/postgres (via the verdict cache), which throws
// at module-eval when DATABASE_URL is unset. Same reason the policy modules are
// split from their DB-touching halves.
const SOURCE = readFileSync(resolve(__dirname, "../lib/llmControlMatcher.ts"), "utf8");

const readConstant = (name: string): string => {
  const match = SOURCE.match(new RegExp(`export const ${name} = "([^"]+)"`));
  if (!match?.[1]) throw new Error(`verdictPromptVersionGuard: ${name} not found in source`);
  return match[1];
};

const LLM_CONTROL_MATCHER_PROMPT_VERSION = readConstant("LLM_CONTROL_MATCHER_PROMPT_VERSION");
const LLM_CONTROL_MATCHER_MODEL_ID = readConstant("LLM_CONTROL_MATCHER_MODEL_ID");

/**
 * The answer-determining surface: the prompt builder, the response validator,
 * and the model id. Deliberately NOT the whole file — cache plumbing, logging
 * and comments change often and do not change what the model answers.
 */
function answerDeterminingSource(): string {
  const slice = (startMarker: string, endMarker: string): string => {
    const start = SOURCE.indexOf(startMarker);
    const end = SOURCE.indexOf(endMarker, start);
    if (start === -1 || end === -1) {
      throw new Error(
        `verdictPromptVersionGuard: could not locate "${startMarker}" … "${endMarker}" in ` +
          `llmControlMatcher.ts. The guard must be repaired — do not delete it: without it a ` +
          `prompt change can silently poison every cached verdict.`
      );
    }
    return SOURCE.slice(start, end);
  };

  return [
    LLM_CONTROL_MATCHER_MODEL_ID,
    slice("export function buildControlMatcherPrompt", "\n}"),
    slice("export function validateControlMatcherResponse", "\n}")
  ].join("\n---\n");
}

/** Recorded for prompt version "control-matcher-v1". */
const EXPECTED_SOURCE_DIGEST = "a50406bf43a7d0454ceda92b4b30efab5e3328bf8a83e3ab1d37ac35a9963d5a";

describe("verdict cache — prompt/model version guard", () => {
  it("the answer-determining source has not changed without a prompt-version bump", () => {
    const digest = createHash("sha256").update(answerDeterminingSource()).digest("hex");

    expect(
      digest,
      `The control-matcher prompt, its response validator, or the model id changed.\n` +
        `Cached verdicts are replayed verbatim, so stale answers would keep being served ` +
        `as if produced by the new prompt/model.\n\n` +
        `FIX (both in the same commit):\n` +
        `  1. Bump LLM_CONTROL_MATCHER_PROMPT_VERSION (currently "${LLM_CONTROL_MATCHER_PROMPT_VERSION}")\n` +
        `  2. Set EXPECTED_SOURCE_DIGEST in this test to: ${digest}\n`
    ).toBe(EXPECTED_SOURCE_DIGEST);
  });

  it("the prompt version is part of the cache key, not merely recorded in metadata", () => {
    // If prompt_version ever stopped being a key column, a bump would no longer
    // invalidate anything — it would just relabel rows.
    const cacheSource = readFileSync(resolve(__dirname, "../lib/llm/verdictCache.ts"), "utf8");
    expect(cacheSource).toContain("prompt_version = $4");
    expect(cacheSource).toContain("promptVersion");
  });
});
