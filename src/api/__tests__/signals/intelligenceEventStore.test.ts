/**
 * intelligenceEventStore.test.ts — Intelligence Pipeline Hardening / IE.P4.
 *
 * Verifies the store orchestration against an in-memory fake of the three event
 * tables: first-sighting create, multi-source corroboration into ONE event (no
 * duplicate), idempotent re-projection, severity/status escalation, and timeline
 * accumulation. (Real-Postgres coverage lives in test/isolation/.)
 */

import { describe, it, expect, vi } from "vitest";

// The store imports the elevated pool at module load; stub it (these tests drive
// projectSignalWithClient with an injected fake client, not the real pool).
vi.mock("../../infra/postgres.js", () => ({
  withElevated: vi.fn(),
  pgElevated: { query: vi.fn() }
}));

import {
  projectSignalWithClient,
  toIncomingSignal,
  type EventStoreClient,
  type CyberSignalRow
} from "../../lib/signals/intelligenceEventStore.js";

interface EventRec {
  id: string; canonical_key: string; title: string; executive_summary: string;
  summary_status: string; event_type: string; severity: string; status: string;
  affected_cve: string | null; affected_vendor: string | null;
  source_count: number; confidence: number; ever_exploited: boolean; ever_patched: boolean;
  first_seen_at: unknown; last_seen_at: unknown; revision: number;
}
interface SourceRec {
  id: string; event_id: string; cyber_signal_id: string | null; source: string;
  external_id: string | null; relation: string; confidence: number | null;
  first_contributed_at: unknown; last_contributed_at: unknown; revision: number;
}
interface TimelineRec {
  event_id: string; entry_type: string; occurred_at: unknown; summary: string;
  source: string | null; cyber_signal_id: string | null;
}

/** In-memory relational fake — single-threaded, so FOR UPDATE is a no-op. */
class FakeEventDb implements EventStoreClient {
  events: EventRec[] = [];
  sources: SourceRec[] = [];
  timeline: TimelineRec[] = [];
  private seq = 0;

  async query<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<{ rows: T[] }> {
    const t = text.trim();
    const rows = (r: unknown[]): { rows: T[] } => ({ rows: r as T[] });

    if (t === "BEGIN" || t === "COMMIT" || t === "ROLLBACK") return rows([]);

    if (t.includes("INSERT INTO intelligence_event_timeline")) {
      const [event_id, entry_type, occurred_at, summary, source, cyber_signal_id] = params;
      this.timeline.push({ event_id, entry_type, occurred_at, summary, source, cyber_signal_id } as TimelineRec);
      return rows([]);
    }
    if (t.includes("INSERT INTO intelligence_event_sources")) {
      const [event_id, csid, source, external_id, relation, confidence, first] = params;
      const existing = this.sources.find((s) => s.event_id === event_id && s.cyber_signal_id === csid);
      if (existing) { existing.last_contributed_at = first; existing.revision += 1; }
      else this.sources.push({
        id: `src-${++this.seq}`, event_id: event_id as string, cyber_signal_id: csid as string | null,
        source: source as string, external_id: external_id as string | null, relation: relation as string,
        confidence: confidence as number | null, first_contributed_at: first, last_contributed_at: first, revision: 1
      });
      return rows([]);
    }
    if (t.startsWith("INSERT INTO intelligence_events")) {
      const key = params[0] as string;
      if (this.events.some((e) => e.canonical_key === key)) return rows([]); // ON CONFLICT DO NOTHING
      const id = `evt-${++this.seq}`;
      this.events.push({
        id, canonical_key: key, title: params[1] as string, executive_summary: params[2] as string,
        summary_status: params[3] as string, event_type: params[4] as string, severity: params[5] as string,
        status: params[6] as string, affected_cve: params[7] as string | null, affected_vendor: params[8] as string | null,
        source_count: params[9] as number, confidence: params[10] as number,
        ever_exploited: params[11] as boolean, ever_patched: params[12] as boolean,
        first_seen_at: params[13], last_seen_at: params[13], revision: 0
      });
      return rows([{ id } as unknown]);
    }
    if (t.startsWith("UPDATE intelligence_events")) {
      const ev = this.events.find((e) => e.id === params[0]);
      if (ev) {
        ev.severity = params[1] as string; ev.status = params[2] as string;
        ev.source_count = params[3] as number; ev.confidence = params[4] as number;
        ev.affected_cve = ev.affected_cve ?? (params[5] as string | null);
        ev.affected_vendor = ev.affected_vendor ?? (params[6] as string | null);
        ev.ever_exploited = params[7] as boolean; ev.ever_patched = params[8] as boolean;
        ev.last_seen_at = params[9]; ev.revision += 1;
      }
      return rows([]);
    }
    if (t.includes("FROM intelligence_events") && t.includes("WHERE canonical_key")) {
      const ev = this.events.find((e) => e.canonical_key === params[0]);
      return rows(ev ? [{ id: ev.id, status: ev.status, severity: ev.severity, source_count: ev.source_count, revision: ev.revision, ever_exploited: ev.ever_exploited, ever_patched: ev.ever_patched }] : []);
    }
    if (t.includes("FROM intelligence_event_sources WHERE event_id")) {
      return rows(this.sources.filter((s) => s.event_id === params[0]).map((s) => ({ cyber_signal_id: s.cyber_signal_id, source: s.source })));
    }
    throw new Error("unhandled query: " + t.slice(0, 70));
  }
}

function csRow(part: Partial<CyberSignalRow>): CyberSignalRow {
  return {
    id: "cs-1", source: "bleepingcomputer", signal_type: "cve", severity: "High",
    normalized_summary: "Acme Gateway RCE flaw disclosed. Update available soon.",
    affected_vendor: "Acme", affected_cve: "CVE-2026-4242", external_id: null,
    dedup_hash: "d1", ingestion_timestamp: "2026-07-07T10:00:00.000Z", ...part
  };
}

describe("intelligenceEventStore — projection", () => {
  it("first sighting creates one event with a canonical source and first_seen timeline", async () => {
    const db = new FakeEventDb();
    const out = await projectSignalWithClient(db, toIncomingSignal(csRow({})));
    expect(out.isNew).toBe(true);
    expect(out.canonicalKey).toBe("cve:CVE-2026-4242");
    expect(db.events).toHaveLength(1);
    expect(db.events[0].source_count).toBe(1);
    expect(db.events[0].status).toBe("new");
    expect(db.sources).toHaveLength(1);
    expect(db.sources[0].relation).toBe("canonical");
    expect(db.timeline.map((t) => t.entry_type)).toEqual(["first_seen"]);
  });

  it("a second source corroborates into the SAME event (no duplicate) and appends timeline", async () => {
    const db = new FakeEventDb();
    await projectSignalWithClient(db, toIncomingSignal(csRow({ id: "cs-1", source: "bleepingcomputer", dedup_hash: "d1" })));
    const out = await projectSignalWithClient(db, toIncomingSignal(csRow({ id: "cs-2", source: "krebsonsecurity", dedup_hash: "d2" })));
    expect(out.isNew).toBe(false);
    expect(out.changed).toBe(true);
    expect(db.events).toHaveLength(1); // still ONE event
    expect(db.events[0].source_count).toBe(2);
    expect(db.events[0].status).toBe("corroborating");
    expect(db.sources).toHaveLength(2);
    expect(db.timeline.map((t) => t.entry_type)).toContain("corroborated");
  });

  it("re-projecting an already-contributed signal is a no-op", async () => {
    const db = new FakeEventDb();
    await projectSignalWithClient(db, toIncomingSignal(csRow({ id: "cs-1" })));
    const before = { events: db.events.length, sources: db.sources.length, timeline: db.timeline.length, rev: db.events[0].revision };
    const out = await projectSignalWithClient(db, toIncomingSignal(csRow({ id: "cs-1" })));
    expect(out.changed).toBe(false);
    expect(db.events.length).toBe(before.events);
    expect(db.sources.length).toBe(before.sources);
    expect(db.timeline.length).toBe(before.timeline);
    expect(db.events[0].revision).toBe(before.rev); // no revision bump
  });

  it("a KEV report escalates severity to peak and status to actively_exploited", async () => {
    const db = new FakeEventDb();
    await projectSignalWithClient(db, toIncomingSignal(csRow({ id: "cs-1", source: "bleepingcomputer", severity: "Moderate", dedup_hash: "d1" })));
    const out = await projectSignalWithClient(db, toIncomingSignal(csRow({ id: "cs-2", source: "cisa_kev", severity: "Critical", dedup_hash: "d2" })));
    expect(out.changed).toBe(true);
    expect(db.events[0].severity).toBe("Critical");
    expect(db.events[0].status).toBe("actively_exploited");
    expect(db.events[0].ever_exploited).toBe(true);
    const types = db.timeline.map((t) => t.entry_type);
    expect(types).toContain("severity_change");
    expect(types).toContain("exploit_activity");
    expect(db.events[0].revision).toBeGreaterThan(0);
  });
});
