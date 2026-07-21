"use client";

/**
 * FindingsQueueToolbar.tsx — the compact search/filter/sort toolbar above the
 * scalable Risk Findings queue (SECURELOGIC_FINDINGS_QUEUE_CONTROLS_ENABLED).
 *
 * All state is URL-driven (queueControls.ts): every control navigates to a new
 * findings URL, so the state survives a reload and Back restores it after
 * opening a finding. This component only reads the parsed state + result totals
 * and pushes new URLs; it holds no source-of-truth state of its own except the
 * in-progress search text.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  type QueueState,
  type PinnableFilterKey,
  SEVERITY_OPTIONS,
  DOMAIN_OPTIONS,
  GOVERNANCE_OPTIONS,
  OPERATIONAL_OPTIONS,
  DUE_OPTIONS,
  SORT_OPTIONS,
  SORT_LABELS,
  DUE_LABELS,
  GOVERNANCE_LABELS,
  OPERATIONAL_LABELS,
  activeFilterChips,
  clearFilter,
  clearAllFilters,
  hasActiveFilters,
  queueHref,
  withField,
  resultRangeLabel,
} from "./queueControls";

const CONTROL: React.CSSProperties = {
  background: "var(--color-brand-surface, #111827)",
  border: "1px solid #1e293b",
  borderRadius: 8,
  color: "#e2e8f0",
  fontSize: 13,
  padding: "7px 10px",
};

const LABEL: React.CSSProperties = {
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: "#64748b",
  marginBottom: 4,
  display: "block",
};

const TOGGLE_ON: React.CSSProperties = {
  background: "rgba(0,196,180,0.15)",
  color: "#00c4b4",
  border: "1px solid rgba(0,196,180,0.4)",
};
const TOGGLE_OFF: React.CSSProperties = {
  background: "transparent",
  color: "#94a3b8",
  border: "1px solid #1e293b",
};

export function FindingsQueueToolbar({
  state,
  total,
  count,
  bucketId,
  hiddenFilters,
}: {
  state: QueueState;
  total: number;
  count: number;
  /**
   * The Operations Center bucket this toolbar refines. Every URL it produces
   * carries `bucket=<id>` instead of `queue=all`, so search/filter/sort/page —
   * and Clear all — stay INSIDE the bucket (its definition is the implicit,
   * never-clearable filter). Absent = the browse queue, unchanged.
   */
  bucketId?: string;
  /** Axes the bucket definition already pins — hidden, never lying controls. */
  hiddenFilters?: readonly PinnableFilterKey[];
}) {
  const router = useRouter();
  const [searchText, setSearchText] = useState(state.q);

  const extra = bucketId ? { bucket: bucketId } : undefined;
  const hidden = new Set(hiddenFilters ?? []);
  const go = (next: QueueState) => router.push(queueHref(next, extra));

  const submitSearch = () => {
    const q = searchText.trim();
    if (q === state.q) return;
    go(withField(state, "q", q));
  };

  const chips = activeFilterChips(state);

  return (
    <div className="mb-6">
      {/* Row 1: search + sort + result count */}
      <div className="flex items-end gap-3 flex-wrap mb-3">
        <div style={{ flex: "1 1 260px", minWidth: 220 }}>
          <label style={LABEL} htmlFor="findings-search">Search</label>
          <div className="flex gap-2">
            <input
              id="findings-search"
              type="search"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submitSearch(); }}
              onBlur={submitSearch}
              placeholder="Title, finding ID, CVE, vendor, asset, description"
              aria-label="Search findings"
              style={{ ...CONTROL, flex: 1, width: "100%" }}
            />
            <button
              type="button"
              onClick={submitSearch}
              style={{ ...CONTROL, cursor: "pointer", color: "#00c4b4", borderColor: "rgba(0,196,180,0.4)" }}
            >
              Search
            </button>
          </div>
        </div>

        <div>
          <label style={LABEL} htmlFor="findings-sort">Sort</label>
          <select
            id="findings-sort"
            value={state.sort}
            onChange={(e) => go(withField(state, "sort", e.target.value as QueueState["sort"]))}
            style={{ ...CONTROL, cursor: "pointer" }}
            aria-label="Sort findings"
          >
            {SORT_OPTIONS.map((s) => (
              <option key={s} value={s}>{SORT_LABELS[s]}</option>
            ))}
          </select>
        </div>

        <div style={{ marginLeft: "auto" }}>
          <span className="text-xs" style={{ color: "#94a3b8" }} aria-live="polite">
            {resultRangeLabel(state.page, count, total)}
          </span>
        </div>
      </div>

      {/* Row 2: dropdown filters */}
      <div className="flex items-end gap-3 flex-wrap mb-3">
        <FilterSelect
          label="Severity" value={state.severity}
          onChange={(v) => go(withField(state, "severity", v))}
          options={SEVERITY_OPTIONS.map((s) => ({ value: s, label: s }))}
        />
        {!hidden.has("domain") && (
          <FilterSelect
            label="Domain" value={state.domain}
            onChange={(v) => go(withField(state, "domain", v))}
            options={DOMAIN_OPTIONS.map((d) => ({ value: d, label: d }))}
          />
        )}
        {!hidden.has("governance") && (
          <FilterSelect
            label="Governance" value={state.governance}
            onChange={(v) => go(withField(state, "governance", v))}
            options={GOVERNANCE_OPTIONS.map((g) => ({ value: g, label: GOVERNANCE_LABELS[g] }))}
          />
        )}
        {!hidden.has("operational") && (
          <FilterSelect
            label="Operational" value={state.operational}
            onChange={(v) => go(withField(state, "operational", v))}
            options={OPERATIONAL_OPTIONS.map((o) => ({ value: o, label: OPERATIONAL_LABELS[o] }))}
          />
        )}
        {!hidden.has("due") && (
          <FilterSelect
            label="Due status" value={state.due}
            onChange={(v) => go(withField(state, "due", v))}
            options={DUE_OPTIONS.map((d) => ({ value: d, label: DUE_LABELS[d] }))}
          />
        )}
        <div>
          <label style={LABEL} htmlFor="created-from">Created from</label>
          <input
            id="created-from" type="date" value={state.createdFrom}
            onChange={(e) => go(withField(state, "createdFrom", e.target.value))}
            style={{ ...CONTROL, cursor: "pointer" }}
          />
        </div>
        <div>
          <label style={LABEL} htmlFor="created-to">Created to</label>
          <input
            id="created-to" type="date" value={state.createdTo}
            onChange={(e) => go(withField(state, "createdTo", e.target.value))}
            style={{ ...CONTROL, cursor: "pointer" }}
          />
        </div>
      </div>

      {/* Row 3: boolean toggles */}
      <div className="flex items-center gap-2 flex-wrap mb-3">
        {!hidden.has("assignedToMe") && (
          <Toggle label="Assigned to me" on={state.assignedToMe} onClick={() => go(withField(state, "assignedToMe", !state.assignedToMe))} />
        )}
        <Toggle label="Has remediation action" on={state.hasAction} onClick={() => go(withField(state, "hasAction", !state.hasAction))} />
        <Toggle label="Has evidence" on={state.hasEvidence} onClick={() => go(withField(state, "hasEvidence", !state.hasEvidence))} />
      </div>

      {/* Row 4: active-filter chips + Clear all */}
      {chips.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs" style={{ color: "#64748b" }}>Filters:</span>
          {chips.map((c) => (
            <button
              key={String(c.key)}
              type="button"
              onClick={() => go(clearFilter(state, c.key))}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs"
              style={{ background: "rgba(0,196,180,0.1)", color: "#00c4b4", border: "1px solid rgba(0,196,180,0.3)" }}
              aria-label={`Remove filter ${c.label}`}
            >
              {c.label}
              <span aria-hidden style={{ opacity: 0.7 }}>✕</span>
            </button>
          ))}
          {hasActiveFilters(state) && (
            /* Clears the USER's filters only — in a bucket, the href keeps
               bucket=<id>, so the bucket's implicit filter is never removed. */
            <Link
              href={queueHref(clearAllFilters(state), extra)}
              className="text-xs font-medium"
              style={{ color: "#94a3b8", textDecoration: "underline" }}
            >
              Clear all
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  const id = `filter-${label.toLowerCase().replace(/\s+/g, "-")}`;
  return (
    <div>
      <label style={LABEL} htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...CONTROL, cursor: "pointer", minWidth: 130 }}
        aria-label={label}
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium transition-colors"
      style={on ? TOGGLE_ON : TOGGLE_OFF}
    >
      {label}
      {on && <span className="ml-1.5" style={{ opacity: 0.7 }} aria-hidden>✕</span>}
    </button>
  );
}
