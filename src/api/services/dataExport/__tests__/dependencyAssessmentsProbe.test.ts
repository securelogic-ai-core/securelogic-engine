/**
 * dependencyAssessmentsProbe.test.ts — the information_schema presence check
 * (Decision Q3), with a mocked QueryRunner (no DB).
 */

import { describe, it, expect } from "vitest";
import { dependencyAssessmentsHasReviewerUuid } from "../dependencyAssessmentsProbe";
import type { QueryRunner } from "../types";

describe("dependencyAssessmentsHasReviewerUuid", () => {
  it("returns true when information_schema reports a matching column", async () => {
    const run: QueryRunner = async () => ({ rows: [{ "?column?": 1 }] });
    expect(await dependencyAssessmentsHasReviewerUuid(run)).toBe(true);
  });

  it("returns false when no row comes back", async () => {
    const run: QueryRunner = async () => ({ rows: [] });
    expect(await dependencyAssessmentsHasReviewerUuid(run)).toBe(false);
  });

  it("probes the right table and column via bound parameters (no interpolation)", async () => {
    let capturedSql = "";
    let capturedValues: unknown[] | undefined;
    const run: QueryRunner = async (text, values) => {
      capturedSql = text;
      capturedValues = values;
      return { rows: [] };
    };
    await dependencyAssessmentsHasReviewerUuid(run);
    expect(capturedSql).toMatch(/information_schema\.columns/i);
    expect(capturedSql).toMatch(/current_schema\(\)/i);
    expect(capturedValues).toEqual(["dependency_assessments", "reviewer_uuid"]);
  });
});
