/**
 * briefTitleBackfill.test.ts — W0 stored-title integrity.
 *
 * The backfill repairs mid-word 77-char + "..." titles persisted by the
 * legacy cap, re-deriving from the source signal with the Q4 quality
 * contract forced ON. Contract under test:
 *   - only the legacy damage signature is touched;
 *   - unrecoverable rows (source signal gone) are skipped, never invented;
 *   - content_json / content_markdown stay consistent with the item rows;
 *   - dry-run writes nothing.
 */
import { describe, it, expect } from "vitest";
import {
  isLegacyTruncatedTitle,
  planTitleRepair,
  patchContentJsonTitles,
  patchMarkdownTitles,
  backfillBriefTitles,
  type Queryable,
  type TitleRepair,
} from "../lib/briefTitleBackfill.js";

const LONG_SOURCE_TITLE =
  "Critical authentication bypass in Acme Cloud Gateway allows unauthenticated remote attackers to execute arbitrary code on exposed management interfaces";
// What the legacy cap stored: slice(0, 77) + "..." — exactly 80 chars.
const DAMAGED_TITLE = `${LONG_SOURCE_TITLE.slice(0, 77)}...`;

const signal = {
  signal_type: "vulnerability",
  normalized_summary: "Attackers are exploiting an unauthenticated RCE.",
  affected_cve: "CVE-2026-1234",
  affected_vendor: "Acme Cloud",
  raw_payload: { title: LONG_SOURCE_TITLE },
};

const damagedRow = {
  id: "item-1",
  brief_id: "brief-1",
  title: DAMAGED_TITLE,
  cyber_signal_id: "sig-1",
  signal,
};

describe("isLegacyTruncatedTitle", () => {
  it("matches exactly the legacy slice(0,77)+'...' shape", () => {
    expect(DAMAGED_TITLE).toHaveLength(80);
    expect(isLegacyTruncatedTitle(DAMAGED_TITLE)).toBe(true);
    expect(isLegacyTruncatedTitle("Short title...")).toBe(false);
    expect(isLegacyTruncatedTitle("x".repeat(80))).toBe(false);
    expect(isLegacyTruncatedTitle(`${"x".repeat(81)}...`)).toBe(false);
  });
});

describe("planTitleRepair", () => {
  it("re-derives a boundary-safe title that no longer carries the damage signature", () => {
    const repair = planTitleRepair(damagedRow, false);
    expect(repair).not.toBeNull();
    expect(repair!.newTitle).not.toBe(DAMAGED_TITLE);
    expect(isLegacyTruncatedTitle(repair!.newTitle)).toBe(false);
    // Quality contract: never a bare mid-word "..." cut.
    expect(repair!.newTitle.endsWith("...")).toBe(false);
  });

  it("skips rows whose source signal is gone — a title is repaired, never invented", () => {
    expect(
      planTitleRepair(
        { ...damagedRow, cyber_signal_id: null, signal: null },
        false
      )
    ).toBeNull();
  });

  it("returns null when re-derivation reproduces the stored title", () => {
    // A source title that is naturally 80 chars ending in "..." passes the
    // quality cap unchanged — nothing to repair.
    const natural = `${"a".repeat(77)}...`;
    const row = {
      ...damagedRow,
      title: natural,
      signal: { ...signal, raw_payload: { title: natural } },
    };
    expect(planTitleRepair(row, false)).toBeNull();
  });
});

describe("patchContentJsonTitles", () => {
  const repairs: TitleRepair[] = [
    {
      itemId: "item-1",
      briefId: "brief-1",
      cyberSignalId: "sig-1",
      oldTitle: DAMAGED_TITLE,
      newTitle: "Repaired title",
    },
  ];

  it("patches the item matching both cyber_signal_id and the old title", () => {
    const contentJson = {
      categories: [
        {
          items: [
            { cyber_signal_id: "sig-1", title: DAMAGED_TITLE },
            { cyber_signal_id: "sig-2", title: "Untouched" },
          ],
        },
      ],
    };
    const { patched, changed } = patchContentJsonTitles(contentJson, repairs);
    expect(changed).toBe(1);
    const items = (patched as typeof contentJson).categories[0]!.items;
    expect(items[0]!.title).toBe("Repaired title");
    expect(items[1]!.title).toBe("Untouched");
    // The stored original is never mutated in place.
    expect(contentJson.categories[0]!.items[0]!.title).toBe(DAMAGED_TITLE);
  });

  it("tolerates malformed blobs byte-identically", () => {
    expect(patchContentJsonTitles(null, repairs).changed).toBe(0);
    expect(patchContentJsonTitles({ no: "categories" }, repairs).changed).toBe(0);
  });
});

describe("patchMarkdownTitles", () => {
  it("replaces exact occurrences and leaves everything else alone", () => {
    const md = `## Brief\n\n### ${DAMAGED_TITLE}\n\nBody text.`;
    const { patched, changed } = patchMarkdownTitles(md, [
      {
        itemId: "item-1",
        briefId: "brief-1",
        cyberSignalId: "sig-1",
        oldTitle: DAMAGED_TITLE,
        newTitle: "Repaired title",
      },
    ]);
    expect(changed).toBe(1);
    expect(patched).toContain("### Repaired title");
    expect(patched).not.toContain(DAMAGED_TITLE);
    expect(patched).toContain("Body text.");
  });
});

describe("backfillBriefTitles", () => {
  function fakeDb(): { db: Queryable; writes: string[] } {
    const writes: string[] = [];
    const db: Queryable = {
      async query<T>(text: string, params?: unknown[]) {
        if (text.includes("FROM intelligence_brief_items")) {
          return {
            rows: [
              {
                id: "item-1",
                brief_id: "brief-1",
                title: DAMAGED_TITLE,
                cyber_signal_id: "sig-1",
                signal_type: signal.signal_type,
                normalized_summary: signal.normalized_summary,
                affected_cve: signal.affected_cve,
                affected_vendor: signal.affected_vendor,
                raw_payload: signal.raw_payload,
              },
              {
                id: "item-orphan",
                brief_id: "brief-1",
                title: DAMAGED_TITLE,
                cyber_signal_id: null,
                signal_type: null,
                normalized_summary: null,
                affected_cve: null,
                affected_vendor: null,
                raw_payload: null,
              },
            ] as T[],
          };
        }
        if (text.includes("SELECT id, content_json")) {
          return {
            rows: [
              {
                id: "brief-1",
                content_json: {
                  categories: [
                    { items: [{ cyber_signal_id: "sig-1", title: DAMAGED_TITLE }] },
                  ],
                },
                content_markdown: `### ${DAMAGED_TITLE}`,
              },
            ] as T[],
          };
        }
        writes.push(`${text} :: ${JSON.stringify(params)}`);
        return { rows: [] as T[] };
      },
    };
    return { db, writes };
  }

  it("dry-run reports repairs and unrecoverable rows without writing", async () => {
    const { db, writes } = fakeDb();
    const result = await backfillBriefTitles(db, { apply: false, sanitizeEnabled: false });

    expect(result.scanned).toBe(2);
    expect(result.repairable).toBe(1);
    expect(result.skippedNoSignal).toBe(1);
    expect(result.itemsUpdated).toBe(0);
    expect(result.briefsPatched).toBe(0);
    expect(result.sample).toHaveLength(1);
    expect(writes).toHaveLength(0);
  });

  it("apply updates the item row and keeps the brief snapshot consistent", async () => {
    const { db, writes } = fakeDb();
    const result = await backfillBriefTitles(db, { apply: true, sanitizeEnabled: false });

    expect(result.itemsUpdated).toBe(1);
    expect(result.briefsPatched).toBe(1);
    expect(writes.some((w) => w.includes("UPDATE intelligence_brief_items"))).toBe(true);
    expect(writes.some((w) => w.includes("UPDATE intelligence_briefs"))).toBe(true);
    // The orphaned row is never written.
    expect(writes.some((w) => w.includes("item-orphan"))).toBe(false);
  });
});
