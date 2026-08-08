/**
 * briefTitleBackfill.ts — W0 (Brief content integrity): repair STORED brief
 * item titles that were cut mid-word at 77 chars + "..." by the legacy title
 * cap (IQP Q4 defect #1). The Q4 flag fixes generation going forward; this
 * backfill repairs the damage already persisted, because truncated titles are
 * STORED — a flag flip alone leaves every archived brief broken.
 *
 * What it does, per damaged item:
 *   1. Detects the legacy truncation signature (length exactly 80, "..."
 *      suffix — the only shape the legacy `capTitle` ever produced when it
 *      truncated).
 *   2. Re-derives the title from the item's SOURCE SIGNAL via the same
 *      buildItemTitle used at generation, with the quality contract forced ON
 *      (sentence/word-boundary cap at 120, never a mid-word cut).
 *   3. Updates intelligence_brief_items.title, and keeps the brief's stored
 *      content_json snapshot and content_markdown consistent (the app's
 *      analysis lookup falls back on title equality, so the snapshot and the
 *      row must never disagree).
 *
 * What it deliberately does NOT do:
 *   - Items whose source signal is gone (cyber_signal_id NULL — ON DELETE SET
 *     NULL) are SKIPPED: the full text is unrecoverable and inventing one
 *     would trade a truncation for a fabrication. They are counted and
 *     reported instead.
 *   - Summaries, relevance, categories: out of scope. Titles only.
 *
 * Tenancy: intelligence_brief_items rows are org-scoped; this is an
 * operator-run maintenance pass over ALL orgs (same class as the cluster-key
 * backfill) using the elevated client. It changes displayed wording only —
 * never category/relevance/ordering — and is idempotent: repaired titles no
 * longer match the damage signature, so a re-run finds nothing to do.
 */

import {
  buildItemTitle,
  type CyberSignalForTitle,
} from "./intelligenceBriefGenerator.js";

/** Minimal client surface so the backfill is injectable + unit-testable. */
export interface Queryable {
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[]
  ): Promise<{ rows: T[] }>;
}

/**
 * The legacy capTitle truncation signature: `text.slice(0, 77) + "..."` —
 * always exactly 80 chars ending in "...". (A source title that is naturally
 * ≤80 chars passed through unchanged, so it can only collide with this
 * signature if it was exactly 80 chars AND ended in "..." — in which case
 * re-deriving from the same source reproduces it and the row is left alone.)
 */
export function isLegacyTruncatedTitle(title: string): boolean {
  return title.length === 80 && title.endsWith("...");
}

export interface DamagedItemRow {
  id: string;
  brief_id: string;
  title: string;
  cyber_signal_id: string | null;
  signal: CyberSignalForTitle | null;
}

export interface TitleRepair {
  itemId: string;
  briefId: string;
  cyberSignalId: string;
  oldTitle: string;
  newTitle: string;
}

/**
 * Decide the repair for one damaged row. Null when the row must be left
 * untouched: source signal gone (unrecoverable), re-derivation empty, or the
 * re-derived title equals what is already stored.
 */
export function planTitleRepair(
  row: DamagedItemRow,
  sanitizeEnabled: boolean
): TitleRepair | null {
  if (!row.cyber_signal_id || !row.signal) return null;
  const newTitle = buildItemTitle(row.signal, sanitizeEnabled, true);
  if (!newTitle || newTitle === row.title) return null;
  return {
    itemId: row.id,
    briefId: row.brief_id,
    cyberSignalId: row.cyber_signal_id,
    oldTitle: row.title,
    newTitle,
  };
}

/**
 * Patch a brief's stored content_json in memory: for each repair, the
 * category item matching BOTH cyber_signal_id and the old title gets the new
 * title. Structural mismatches are tolerated (content_json is loosely typed
 * on the wire); anything unrecognized is left byte-identical.
 */
export function patchContentJsonTitles(
  contentJson: unknown,
  repairs: readonly TitleRepair[]
): { patched: unknown; changed: number } {
  if (!contentJson || typeof contentJson !== "object") {
    return { patched: contentJson, changed: 0 };
  }
  const bySignal = new Map(repairs.map((r) => [r.cyberSignalId, r]));
  const clone = structuredClone(contentJson) as Record<string, unknown>;
  const categories = clone["categories"];
  if (!Array.isArray(categories)) return { patched: contentJson, changed: 0 };

  let changed = 0;
  for (const cat of categories) {
    if (!cat || typeof cat !== "object") continue;
    const items = (cat as { items?: unknown }).items;
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const signalId = rec["cyber_signal_id"];
      if (typeof signalId !== "string") continue;
      const repair = bySignal.get(signalId);
      if (repair && rec["title"] === repair.oldTitle) {
        rec["title"] = repair.newTitle;
        changed++;
      }
    }
  }
  return changed > 0 ? { patched: clone, changed } : { patched: contentJson, changed: 0 };
}

/**
 * Patch content_markdown by exact-string replacement of each old title. The
 * damaged titles are 80-char strings ending in "..." — distinctive enough
 * that exact replacement is surgical; anything not present is untouched.
 */
export function patchMarkdownTitles(
  markdown: string,
  repairs: readonly TitleRepair[]
): { patched: string; changed: number } {
  let patched = markdown;
  let changed = 0;
  for (const r of repairs) {
    if (patched.includes(r.oldTitle)) {
      patched = patched.split(r.oldTitle).join(r.newTitle);
      changed++;
    }
  }
  return { patched, changed };
}

export interface BriefTitleBackfillResult {
  /** Items matching the legacy truncation signature. */
  scanned: number;
  /** Items with a computed repair (apply=false: what WOULD change). */
  repairable: number;
  /** Damaged items skipped because their source signal row is gone. */
  skippedNoSignal: number;
  /** Damaged items whose re-derived title matched the stored one. */
  unchanged: number;
  /** Item rows updated (0 in dry-run). */
  itemsUpdated: number;
  /** Brief rows whose content_json/content_markdown were patched (0 in dry-run). */
  briefsPatched: number;
  /** Sample of planned repairs for operator review (first 10). */
  sample: Array<{ briefId: string; oldTitle: string; newTitle: string }>;
}

interface DbDamagedRow {
  id: string;
  brief_id: string;
  title: string;
  cyber_signal_id: string | null;
  signal_type: string | null;
  normalized_summary: string | null;
  affected_cve: string | null;
  affected_vendor: string | null;
  raw_payload: Record<string, unknown> | null;
}

interface DbBriefRow {
  id: string;
  content_json: unknown;
  content_markdown: string | null;
}

/**
 * Scan for legacy-truncated titles and (when apply=true) repair item rows and
 * their briefs' stored snapshots. Dry-run by default: apply=false performs
 * zero writes and reports exactly what would change.
 */
export async function backfillBriefTitles(
  db: Queryable,
  opts: { apply: boolean; sanitizeEnabled: boolean }
): Promise<BriefTitleBackfillResult> {
  const { rows } = await db.query<DbDamagedRow>(
    `SELECT i.id, i.brief_id, i.title, i.cyber_signal_id,
            s.signal_type, s.normalized_summary, s.affected_cve,
            s.affected_vendor, s.raw_payload
       FROM intelligence_brief_items i
       LEFT JOIN cyber_signals s ON s.id = i.cyber_signal_id
      WHERE char_length(i.title) = 80
        AND i.title LIKE '%...'
      ORDER BY i.brief_id, i.sort_order`
  );

  const result: BriefTitleBackfillResult = {
    scanned: rows.length,
    repairable: 0,
    skippedNoSignal: 0,
    unchanged: 0,
    itemsUpdated: 0,
    briefsPatched: 0,
    sample: [],
  };

  const repairs: TitleRepair[] = [];
  for (const row of rows) {
    // Defensive re-check in JS: the SQL predicate mirrors
    // isLegacyTruncatedTitle, but the JS predicate is the contract.
    if (!isLegacyTruncatedTitle(row.title)) continue;
    const signal: CyberSignalForTitle | null =
      row.cyber_signal_id && row.signal_type !== null
        ? {
            signal_type: row.signal_type,
            normalized_summary: row.normalized_summary ?? "",
            affected_cve: row.affected_cve,
            affected_vendor: row.affected_vendor,
            raw_payload: row.raw_payload,
          }
        : null;
    const repair = planTitleRepair(
      {
        id: row.id,
        brief_id: row.brief_id,
        title: row.title,
        cyber_signal_id: row.cyber_signal_id,
        signal,
      },
      opts.sanitizeEnabled
    );
    if (!repair) {
      if (!signal) result.skippedNoSignal++;
      else result.unchanged++;
      continue;
    }
    repairs.push(repair);
    result.repairable++;
    if (result.sample.length < 10) {
      result.sample.push({
        briefId: repair.briefId,
        oldTitle: repair.oldTitle,
        newTitle: repair.newTitle,
      });
    }
  }

  if (!opts.apply || repairs.length === 0) return result;

  // Group repairs per brief so each brief's snapshot is patched exactly once.
  const byBrief = new Map<string, TitleRepair[]>();
  for (const r of repairs) {
    const list = byBrief.get(r.briefId) ?? [];
    list.push(r);
    byBrief.set(r.briefId, list);
  }

  for (const [briefId, briefRepairs] of byBrief) {
    for (const r of briefRepairs) {
      await db.query(
        `UPDATE intelligence_brief_items SET title = $1 WHERE id = $2 AND title = $3`,
        [r.newTitle, r.itemId, r.oldTitle]
      );
      result.itemsUpdated++;
    }

    const { rows: briefRows } = await db.query<DbBriefRow>(
      `SELECT id, content_json, content_markdown FROM intelligence_briefs WHERE id = $1`,
      [briefId]
    );
    const brief = briefRows[0];
    if (!brief) continue;

    const jsonPatch = patchContentJsonTitles(brief.content_json, briefRepairs);
    const mdPatch = patchMarkdownTitles(brief.content_markdown ?? "", briefRepairs);
    if (jsonPatch.changed > 0 || mdPatch.changed > 0) {
      await db.query(
        `UPDATE intelligence_briefs SET content_json = $1, content_markdown = $2 WHERE id = $3`,
        [JSON.stringify(jsonPatch.patched), mdPatch.patched, briefId]
      );
      result.briefsPatched++;
    }
  }

  return result;
}
