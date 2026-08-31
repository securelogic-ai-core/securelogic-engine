/**
 * canonicalControlPublisher.test.ts — VA-S4 Step 1.
 *
 * The publisher is the ONLY path by which canonical reference content can enter
 * the database: migrations create the tables and grant `app_request` SELECT
 * only, and a migration cannot name the human that
 * `canonical_controls_publication_authority_check` requires. So the properties
 * that matter here are governance properties, not row counts:
 *
 *   * publication names a real human, or it does not happen;
 *   * published content is never edited — divergence is REPORTED as drift;
 *   * a dry run executes the real statements and rolls back, so its counts are
 *     the counts an --apply run would produce.
 *
 * The mock client answers on SQL shape rather than a fixed tape, so adding a
 * statement to the publisher does not silently shift every later response into
 * the wrong slot.
 */

import { describe, expect, it } from "vitest";

import {
  CANONICAL_CONTROL_CORPUS,
  CANONICAL_CONTROL_CORPUS_VERSION,
} from "../lib/controls/canonicalControlCorpus.js";
import {
  CanonicalPublicationError,
  publishCanonicalControls,
  validateCorpusContent,
} from "../lib/controls/canonicalControlPublisher.js";
import { CROSSWALK_CORPORA } from "../lib/controls/crosswalkCorpora.js";
import { NIST_CSF_1_1_CROSSWALK } from "../lib/controls/nistCsfCrosswalk.js";

/** Every curated entry across every corpus in the registry, by reference. */
const ALL_CROSSWALK_ENTRIES = CROSSWALK_CORPORA.flatMap((c) => [...c.entries]);
const entryFor = (reference: string) =>
  ALL_CROSSWALK_ENTRIES.find((e) => e.requirement_reference === reference)!;

const PUBLISHER = "99999999-9999-4999-8999-999999999999";

type Call = { sql: string; params: unknown[] };

type Behaviour = {
  /** canonical_controls INSERT outcome: 'inserted' or 'conflict' (already published). */
  controlInsert?: (key: string) => "inserted" | "conflict";
  /** Row returned by the post-conflict SELECT, for drift tests. */
  existingControl?: (key: string) => Record<string, unknown>;
  aliasInsert?: (aliasKey: string) => "inserted" | "conflict";
  /** canonical_key an already-present alias is bound to, for conflict tests. */
  aliasBoundTo?: (aliasKey: string) => string;
  crosswalkInsert?: (reference: string) => "inserted" | "conflict";
  /** The LIVE crosswalk row a conflicting insert reads back, for drift tests. */
  liveCrosswalk?: (reference: string) => Record<string, unknown>;
  publisherExists?: boolean;
};

function makeHarness(b: Behaviour = {}) {
  const calls: Call[] = [];
  let released = 0;

  const client = {
    async query(sql: string, params: unknown[] = []) {
      calls.push({ sql, params });

      if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [], rowCount: 0 };

      if (sql.includes("FROM users WHERE id")) {
        return (b.publisherExists ?? true)
          ? { rows: [{ id: params[0] }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }

      if (sql.includes("INSERT INTO canonical_framework_versions")) {
        return { rows: [], rowCount: 1 };
      }

      if (sql.includes("INSERT INTO canonical_controls")) {
        const key = String(params[0]);
        const outcome = b.controlInsert?.(key) ?? "inserted";
        return outcome === "inserted"
          ? { rows: [{ id: `id-for-${key}` }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }

      if (sql.includes("FROM canonical_controls WHERE canonical_key")) {
        const key = String(params[0]);
        const corpus = CANONICAL_CONTROL_CORPUS.find(
          (c) => key === `securelogic:control:${c.slug}`
        )!;
        return {
          rows: [
            b.existingControl?.(key) ?? {
              id: `id-for-${key}`,
              display_name: corpus.display_name,
              description: corpus.description,
              control_family: corpus.control_family,
            },
          ],
          rowCount: 1,
        };
      }

      if (sql.includes("INSERT INTO canonical_control_aliases")) {
        const aliasKey = String(params[1]);
        return (b.aliasInsert?.(aliasKey) ?? "inserted") === "inserted"
          ? { rows: [], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }

      if (sql.includes("FROM canonical_control_aliases a")) {
        const aliasKey = String(params[0]);
        return { rows: [{ canonical_key: b.aliasBoundTo?.(aliasKey) ?? "" }], rowCount: 1 };
      }

      if (sql.includes("INSERT INTO canonical_control_crosswalk")) {
        const reference = String(params[2]);
        return (b.crosswalkInsert?.(reference) ?? "inserted") === "inserted"
          ? { rows: [], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }

      if (sql.includes("FROM canonical_control_crosswalk")) {
        const reference = String(params[2]);
        const entry = entryFor(reference);
        return {
          rows: [
            b.liveCrosswalk?.(reference) ?? {
              mapping_rationale: entry.rationale,
              mapping_source: "securelogic",
              status: "published",
            },
          ],
          rowCount: 1,
        };
      }

      throw new Error(`unexpected statement: ${sql.slice(0, 60)}`);
    },
    release() {
      released += 1;
    },
  };

  return {
    pool: { connect: async () => client },
    calls,
    released: () => released,
    sqlOf: (needle: string) => calls.filter((c) => c.sql.includes(needle)),
    lastTxStatement: () =>
      [...calls].reverse().find((c) => /^\s*(COMMIT|ROLLBACK)/.test(c.sql))!.sql.trim(),
  };
}

// Every corpus in the registry, not just the first one: the publisher
// publishes them all in one governed act.
const EXPECTED_CROSSWALK_ROWS = ALL_CROSSWALK_ENTRIES.reduce(
  (n, e) => n + e.canonical_control_slugs.length,
  0
);

describe("content validation runs before anything is written", () => {
  it("the shipped corpus and crosswalk are internally consistent", () => {
    expect(() => validateCorpusContent()).not.toThrow();
  });
});

describe("a dry run is a real run that is rolled back", () => {
  it("ROLLBACKs, and reports what an --apply run would have written", async () => {
    const h = makeHarness();
    const result = await publishCanonicalControls(h.pool, { publishedByUserId: PUBLISHER });

    expect(result.applied).toBe(false);
    expect(h.lastTxStatement()).toBe("ROLLBACK");
    expect(h.sqlOf("COMMIT")).toHaveLength(0);

    // The statements really ran — this is the property that separates a dry run
    // from a plan.
    expect(h.sqlOf("INSERT INTO canonical_controls")).toHaveLength(CANONICAL_CONTROL_CORPUS.length);
    expect(result.controls_published).toBe(CANONICAL_CONTROL_CORPUS.length);
    expect(result.crosswalk_published).toBe(EXPECTED_CROSSWALK_ROWS);
    expect(result.corpus_version).toBe(CANONICAL_CONTROL_CORPUS_VERSION);
  });

  it("--apply COMMITs the same work", async () => {
    const h = makeHarness();
    const result = await publishCanonicalControls(h.pool, {
      publishedByUserId: PUBLISHER,
      apply: true,
    });
    expect(result.applied).toBe(true);
    expect(h.lastTxStatement()).toBe("COMMIT");
  });

  it("releases the client either way", async () => {
    const h = makeHarness();
    await publishCanonicalControls(h.pool, { publishedByUserId: PUBLISHER });
    expect(h.released()).toBe(1);
  });
});

describe("publication names a human, or it does not happen", () => {
  it("an unknown publisher aborts before a single content row is written", async () => {
    const h = makeHarness({ publisherExists: false });
    await expect(
      publishCanonicalControls(h.pool, { publishedByUserId: PUBLISHER, apply: true })
    ).rejects.toBeInstanceOf(CanonicalPublicationError);

    expect(h.sqlOf("INSERT INTO canonical_controls")).toHaveLength(0);
    expect(h.sqlOf("INSERT INTO canonical_control_crosswalk")).toHaveLength(0);
    expect(h.lastTxStatement()).toBe("ROLLBACK");
    expect(h.released()).toBe(1);
  });

  it("every published control carries the publisher and status 'published'", async () => {
    const h = makeHarness();
    await publishCanonicalControls(h.pool, { publishedByUserId: PUBLISHER, apply: true });

    for (const call of h.sqlOf("INSERT INTO canonical_controls")) {
      expect(call.sql).toContain("'published'");
      expect(call.sql).toContain("NOW()");
      expect(call.params[4]).toBe(PUBLISHER);
    }
  });

  it("every crosswalk row is curator-sourced, human-approved, and version-stamped", async () => {
    const h = makeHarness();
    await publishCanonicalControls(h.pool, { publishedByUserId: PUBLISHER, apply: true });

    const rows = h.sqlOf("INSERT INTO canonical_control_crosswalk");
    expect(rows).toHaveLength(EXPECTED_CROSSWALK_ROWS);
    for (const call of rows) {
      expect(call.sql).toContain("'securelogic'");
      expect(call.sql).toContain("'securelogic_curator'");
      expect(call.sql).toContain("'published'");
      expect(call.params[5]).toBe(CANONICAL_CONTROL_CORPUS_VERSION); // mapping_version
      expect(call.params[7]).toBe(PUBLISHER);                        // approved_by_user_id
    }
  });

  it("never proposes AI-sourced content — a model may propose, it may not publish", async () => {
    const h = makeHarness();
    await publishCanonicalControls(h.pool, { publishedByUserId: PUBLISHER, apply: true });
    for (const call of h.calls) {
      expect(call.sql).not.toContain("ai_proposed");
      expect(call.sql).not.toContain("ai_extraction");
    }
  });
});

describe("published content is never edited", () => {
  it("issues no UPDATE and no DELETE against any canonical table", async () => {
    // Aliases resolve to the control the corpus says they belong to, so this is
    // a CLEAN re-run: the point being proven is that even when every row
    // already exists, the publisher reaches for no UPDATE. (An alias bound
    // elsewhere would be an identity conflict and the run would refuse — that
    // is covered separately.)
    const h = makeHarness({
      controlInsert: () => "conflict",
      aliasInsert: () => "conflict",
      aliasBoundTo: (aliasKey) => {
        const owner = CANONICAL_CONTROL_CORPUS.find((c) =>
          c.aliases.some((a) => a.alias_key === aliasKey)
        )!;
        return `securelogic:control:${owner.slug}`;
      },
    });
    await publishCanonicalControls(h.pool, { publishedByUserId: PUBLISHER, apply: true });

    for (const call of h.calls) {
      expect(call.sql).not.toMatch(/\bUPDATE\b/);
      expect(call.sql).not.toMatch(/\bDELETE\b/);
    }
  });

  it("a re-run over fully-published content publishes nothing and reports it as already present", async () => {
    const h = makeHarness({
      controlInsert: () => "conflict",
      aliasInsert: () => "conflict",
      aliasBoundTo: (aliasKey) => {
        const owner = CANONICAL_CONTROL_CORPUS.find((c) =>
          c.aliases.some((a) => a.alias_key === aliasKey)
        )!;
        return `securelogic:control:${owner.slug}`;
      },
    });
    const result = await publishCanonicalControls(h.pool, { publishedByUserId: PUBLISHER });

    expect(result.controls_published).toBe(0);
    expect(result.controls_already_published).toBe(CANONICAL_CONTROL_CORPUS.length);
    expect(result.aliases_inserted).toBe(0);
    expect(result.drift).toEqual([]);
    expect(result.alias_conflicts).toEqual([]);
  });

  it("divergence from a published row is REPORTED as drift, not reconciled", async () => {
    const drifted = CANONICAL_CONTROL_CORPUS[0]!;
    const driftedKey = `securelogic:control:${drifted.slug}`;
    const h = makeHarness({
      controlInsert: (key) => (key === driftedKey ? "conflict" : "inserted"),
      existingControl: () => ({
        id: "existing-id",
        display_name: "An older, published wording",
        description: drifted.description,
        control_family: drifted.control_family,
      }),
    });

    const result = await publishCanonicalControls(h.pool, { publishedByUserId: PUBLISHER });

    expect(result.drift).toEqual([
      {
        canonical_key: driftedKey,
        field: "display_name",
        published: "An older, published wording",
        corpus: drifted.display_name,
      },
    ]);
    // Reported — and the row was left exactly as it was.
    for (const call of h.calls) expect(call.sql).not.toMatch(/\bUPDATE\b/);
  });
});

describe("alias identity collisions surface instead of resolving silently", () => {
  it("an alias already bound to a DIFFERENT canonical control is reported", async () => {
    const withAlias = CANONICAL_CONTROL_CORPUS.find((c) => c.aliases.length > 0)!;
    const collided = withAlias.aliases[0]!.alias_key;
    const h = makeHarness({
      aliasInsert: (aliasKey) => (aliasKey === collided ? "conflict" : "inserted"),
      aliasBoundTo: () => "securelogic:control:something-else",
    });

    const result = await publishCanonicalControls(h.pool, { publishedByUserId: PUBLISHER });

    expect(result.alias_conflicts).toEqual([
      {
        alias_key: collided,
        bound_to_key: "securelogic:control:something-else",
        corpus_key: `securelogic:control:${withAlias.slug}`,
      },
    ]);
  });
});

describe("fail closed — ambiguity is never committed alongside", () => {
  const DRIFTED = CANONICAL_CONTROL_CORPUS[0]!;
  const DRIFTED_KEY = `securelogic:control:${DRIFTED.slug}`;

  function driftHarness() {
    return makeHarness({
      controlInsert: (key) => (key === DRIFTED_KEY ? "conflict" : "inserted"),
      existingControl: () => ({
        id: "existing-id",
        display_name: "An older, published wording",
        description: DRIFTED.description,
        control_family: DRIFTED.control_family,
      }),
    });
  }

  it("an --apply run that finds drift ROLLS BACK and throws — it does not commit the rest", async () => {
    const h = driftHarness();
    await expect(
      publishCanonicalControls(h.pool, { publishedByUserId: PUBLISHER, apply: true })
    ).rejects.toThrow(/refusing to publish/);

    expect(h.sqlOf("COMMIT")).toHaveLength(0);
    expect(h.lastTxStatement()).toBe("ROLLBACK");
    expect(h.released()).toBe(1);
  });

  it("the refusal names what it found, so the operator can act on it", async () => {
    const h = driftHarness();
    await expect(
      publishCanonicalControls(h.pool, { publishedByUserId: PUBLISHER, apply: true })
    ).rejects.toThrow(/drifted canonical control field/);
  });

  it("an --apply run that finds an alias identity conflict refuses too", async () => {
    const withAlias = CANONICAL_CONTROL_CORPUS.find((c) => c.aliases.length > 0)!;
    const collided = withAlias.aliases[0]!.alias_key;
    const h = makeHarness({
      aliasInsert: (aliasKey) => (aliasKey === collided ? "conflict" : "inserted"),
      aliasBoundTo: () => "securelogic:control:something-else",
    });
    await expect(
      publishCanonicalControls(h.pool, { publishedByUserId: PUBLISHER, apply: true })
    ).rejects.toThrow(/alias identity conflict/);
    expect(h.sqlOf("COMMIT")).toHaveLength(0);
  });

  it("a DRY RUN reports the same findings without throwing — that is how they are seen", async () => {
    const h = driftHarness();
    const result = await publishCanonicalControls(h.pool, { publishedByUserId: PUBLISHER });
    expect(result.drift).toHaveLength(1);
    expect(result.applied).toBe(false);
    expect(h.lastTxStatement()).toBe("ROLLBACK");
  });

  it("a clean run still commits — fail-closed is not fail-always", async () => {
    const h = makeHarness();
    const result = await publishCanonicalControls(h.pool, {
      publishedByUserId: PUBLISHER,
      apply: true,
    });
    expect(result.drift).toEqual([]);
    expect(result.crosswalk_drift).toEqual([]);
    expect(result.alias_conflicts).toEqual([]);
    expect(h.lastTxStatement()).toBe("COMMIT");
  });
});

describe("a live mapping cannot silently acquire a different meaning", () => {
  const TARGET = NIST_CSF_1_1_CROSSWALK[0]!;

  it("a changed rationale on an already-live mapping is REPORTED, not silently ignored", async () => {
    const h = makeHarness({
      crosswalkInsert: (ref) => (ref === TARGET.requirement_reference ? "conflict" : "inserted"),
      liveCrosswalk: () => ({
        mapping_rationale: "A different justification than the one the corpus states",
        mapping_source: "securelogic",
        status: "published",
      }),
    });
    const result = await publishCanonicalControls(h.pool, { publishedByUserId: PUBLISHER });

    expect(result.crosswalk_drift).toHaveLength(TARGET.canonical_control_slugs.length);
    expect(result.crosswalk_drift[0]).toMatchObject({
      requirement_reference: TARGET.requirement_reference,
      field: "mapping_rationale",
      corpus: TARGET.rationale,
    });
  });

  it("a live mapping that arrived as ai_proposed is reported rather than accepted as ours", async () => {
    const h = makeHarness({
      crosswalkInsert: (ref) => (ref === TARGET.requirement_reference ? "conflict" : "inserted"),
      liveCrosswalk: () => ({
        mapping_rationale: TARGET.rationale,
        mapping_source: "ai_proposed",
        status: "published",
      }),
    });
    const result = await publishCanonicalControls(h.pool, { publishedByUserId: PUBLISHER });
    expect(result.crosswalk_drift.map((d) => d.field)).toContain("mapping_source");
  });

  it("crosswalk drift also refuses an --apply run", async () => {
    const h = makeHarness({
      crosswalkInsert: (ref) => (ref === TARGET.requirement_reference ? "conflict" : "inserted"),
      liveCrosswalk: () => ({
        mapping_rationale: "Changed underneath us",
        mapping_source: "securelogic",
        status: "published",
      }),
    });
    await expect(
      publishCanonicalControls(h.pool, { publishedByUserId: PUBLISHER, apply: true })
    ).rejects.toThrow(/drifted crosswalk field/);
    expect(h.sqlOf("COMMIT")).toHaveLength(0);
  });

  it("mapping_version is deliberately NOT drift — a new pass must not relabel frozen rows", async () => {
    const h = makeHarness({
      crosswalkInsert: () => "conflict",
      liveCrosswalk: (ref) => ({
        mapping_rationale: entryFor(ref).rationale,
        mapping_source: "securelogic",
        status: "published",
      }),
    });
    const result = await publishCanonicalControls(h.pool, { publishedByUserId: PUBLISHER });
    expect(result.crosswalk_drift).toEqual([]);
    expect(result.crosswalk_already_present).toBe(EXPECTED_CROSSWALK_ROWS);
  });
});
