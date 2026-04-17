import { Router } from "express";

const router = Router();

const DASHBOARD_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "img-src 'self' data:",
  "frame-ancestors 'none'"
].join("; ");

router.get("/", (_req, res) => {
  res.setHeader("Content-Security-Policy", DASHBOARD_CSP);
  res.status(200).type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>SecureLogic Ops Dashboard</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: #0a0f1a;
      color: #f1f5f9;
      font-size: 14px;
      line-height: 1.5;
      min-height: 100vh;
    }
    a { color: #00c4b4; text-decoration: none; }
    a:hover { color: #00ddd0; }

    /* Layout */
    .page { max-width: 1400px; margin: 0 auto; padding: 20px 24px 60px; }
    .header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 20px; }
    .header-left { display: flex; align-items: center; gap: 14px; }
    .logo { font-size: 17px; font-weight: 700; color: #f1f5f9; letter-spacing: -0.02em; }
    .logo span { color: #00c4b4; }

    /* Cards */
    .card { background: #0d1b2e; border: 1px solid #1e2d45; border-radius: 10px; padding: 16px; }
    .card-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: #00c4b4; margin-bottom: 12px; }

    /* Section headers */
    .section { margin-top: 24px; }
    .section-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
    .section-title { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: #94a3b8; }

    /* Token strip */
    .token-card { margin-bottom: 16px; }
    .token-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    input[type="password"], input[type="text"], input[type="search"] {
      background: #0a0f1a; color: #f1f5f9;
      border: 1px solid #1e2d45; border-radius: 7px;
      padding: 8px 12px; font-size: 13px; outline: none;
    }
    input[type="password"]:focus, input[type="text"]:focus, input[type="search"]:focus { border-color: #00c4b4; }
    input.token-input { width: 340px; max-width: 100%; }
    input.search-input { width: 220px; max-width: 100%; }

    /* Buttons */
    .btn {
      background: #00c4b4; color: #0a0f1a; border: 0;
      border-radius: 7px; padding: 8px 13px; font-size: 12px;
      font-weight: 700; cursor: pointer; white-space: nowrap;
    }
    .btn:hover { background: #00ddd0; }
    .btn-sm { padding: 5px 10px; font-size: 11px; }
    .btn-ghost { background: #1e2d45; color: #f1f5f9; }
    .btn-ghost:hover { background: #263c55; }
    .btn-ghost.active { background: #00c4b4; color: #0a0f1a; }
    .btn-danger { background: #7f1d1d; color: #fca5a5; }
    .btn-danger:hover { background: #991b1b; }
    .btn-group { display: flex; gap: 4px; flex-wrap: wrap; }

    /* Stat cards row */
    .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 16px; }
    .stat-card { background: #0d1b2e; border: 1px solid #1e2d45; border-radius: 10px; padding: 14px 16px; }
    .stat-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: #94a3b8; margin-bottom: 6px; }
    .stat-value { font-size: 26px; font-weight: 700; color: #f1f5f9; line-height: 1; }
    .stat-sub { font-size: 11px; color: #64748b; margin-top: 4px; }
    .stat-card.danger { border-color: #7f1d1d; }
    .stat-card.danger .stat-value { color: #f87171; }

    /* Two-column grid */
    .row-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    @media (max-width: 700px) { .row-2 { grid-template-columns: 1fr; } }

    /* Health */
    .health-status { font-size: 18px; font-weight: 700; }
    .healthy { color: #22c55e; }
    .degraded { color: #f59e0b; }
    .failing  { color: #ef4444; }
    .health-rows { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
    .health-row { display: flex; justify-content: space-between; font-size: 13px; }
    .health-row .label { color: #94a3b8; }
    .health-row .val { font-weight: 600; }
    .reasons-list { margin-top: 8px; font-size: 12px; color: #f87171; }

    /* Badges */
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; white-space: nowrap; }
    .badge-green  { background: #14532d44; color: #86efac; border: 1px solid #16a34a44; }
    .badge-amber  { background: #78350f44; color: #fcd34d; border: 1px solid #d9770644; }
    .badge-red    { background: #7f1d1d44; color: #fca5a5; border: 1px solid #dc262644; }
    .badge-blue   { background: #1e3a5f44; color: #93c5fd; border: 1px solid #2563eb44; }
    .badge-gray   { background: #1e293b44; color: #94a3b8; border: 1px solid #33415544; }
    .badge-teal   { background: #0d4a4544; color: #5eead4; border: 1px solid #0d928044; }

    /* Filters strip */
    .filters { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px; }
    .filter-label { font-size: 11px; color: #64748b; font-weight: 600; }

    /* Tables */
    .tbl-wrap { overflow-x: auto; border-radius: 8px; border: 1px solid #1e2d45; }
    table { width: 100%; border-collapse: collapse; background: #0d1b2e; font-size: 13px; }
    thead th {
      background: #112036; color: #94a3b8;
      font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
      padding: 9px 12px; text-align: left; border-bottom: 1px solid #1e2d45;
      cursor: pointer; white-space: nowrap; user-select: none;
    }
    thead th:hover { color: #f1f5f9; }
    thead th .sort-arrow { display: inline-block; margin-left: 4px; opacity: 0.4; font-size: 10px; }
    thead th.sorted .sort-arrow { opacity: 1; color: #00c4b4; }
    tbody tr { border-bottom: 1px solid #1e2d45; }
    tbody tr:last-child { border-bottom: none; }
    tbody tr:hover { background: #0f2035; }
    tbody td { padding: 8px 12px; vertical-align: top; color: #cbd5e1; }
    tbody td.primary { color: #f1f5f9; font-weight: 500; }
    tbody td.suppressed { color: #f87171; }
    .no-data { padding: 32px; text-align: center; color: #475569; font-size: 13px; }

    /* Pagination */
    .pagination { display: flex; align-items: center; gap: 10px; margin-top: 12px; font-size: 12px; color: #64748b; }
    .page-info { flex: 1; }

    /* Status dot */
    .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 5px; }
    .dot-green { background: #22c55e; }
    .dot-amber { background: #f59e0b; }
    .dot-red   { background: #ef4444; }
    .dot-blue  { background: #3b82f6; }
    .dot-gray  { background: #475569; }

    /* Misc */
    .muted  { color: #64748b; font-size: 12px; }
    .error-msg { color: #f87171; font-size: 12px; margin-top: 8px; white-space: pre-wrap; word-break: break-word; }
    .refresh-row { display: flex; align-items: center; gap: 10px; font-size: 12px; color: #64748b; }
    .auto-refresh-label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
    .spinner { display: none; }
    .loading .spinner { display: inline; }
  </style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div class="header">
    <div class="header-left">
      <div class="logo">Secure<span>Logic</span> AI</div>
      <div class="muted">Ops Dashboard</div>
    </div>
    <div class="refresh-row">
      <label class="auto-refresh-label">
        <input type="checkbox" id="autoRefreshToggle" />
        Auto-refresh (30s)
      </label>
      <button class="btn btn-ghost btn-sm" id="refreshBtn">&#8635; Refresh</button>
      <span id="lastRefresh"></span>
    </div>
  </div>

  <!-- Token -->
  <div class="card token-card">
    <div class="card-title">Admin Token</div>
    <div class="token-row">
      <input id="tokenInput" class="token-input" type="password" placeholder="Paste admin token" />
      <button class="btn" id="saveTokenBtn">Save &amp; Load</button>
      <button class="btn btn-ghost" id="toggleTokenBtn">Show</button>
      <button class="btn btn-ghost" id="clearTokenBtn">Clear</button>
    </div>
    <div id="tokenStatus" class="muted" style="margin-top:8px;"></div>
    <div id="pageError" class="error-msg"></div>
  </div>

  <!-- Summary stats -->
  <div class="stat-grid" id="statGrid">
    <div class="stat-card"><div class="stat-label">Active Subscribers</div><div class="stat-value" id="statActive">—</div></div>
    <div class="stat-card"><div class="stat-label">Free</div><div class="stat-value" id="statFree">—</div></div>
    <div class="stat-card"><div class="stat-label">Brief Pro</div><div class="stat-value" id="statPro">—</div></div>
    <div class="stat-card"><div class="stat-label">Platform</div><div class="stat-value" id="statPlatform">—</div></div>
    <div class="stat-card"><div class="stat-label">New (7 days)</div><div class="stat-value" id="statNew7d">—</div><div class="stat-sub" id="statNew30d"></div></div>
    <div class="stat-card" id="statSuppCard"><div class="stat-label">Suppressed</div><div class="stat-value" id="statSupp">—</div></div>
  </div>

  <!-- Health + Delivery Totals -->
  <div class="row-2">
    <div class="card">
      <div class="card-title">System Health</div>
      <div><span class="health-status" id="healthStatus">—</span></div>
      <div class="health-rows">
        <div class="health-row"><span class="label">Dead letters</span><span class="val" id="healthDead">—</span></div>
        <div class="health-row"><span class="label">Worker failures (24h)</span><span class="val" id="healthWorkerFails">—</span></div>
        <div class="health-row"><span class="label">Queued deliveries</span><span class="val" id="healthQueued">—</span></div>
        <div class="health-row"><span class="label">Suppressed (paying)</span><span class="val" id="healthSuppPaying">—</span></div>
      </div>
      <div id="healthReasons" class="reasons-list"></div>
    </div>
    <div class="card">
      <div class="card-title">Delivery Totals (Newsletter)</div>
      <div class="health-rows">
        <div class="health-row"><span class="label">Sent</span><span class="val" id="totSent">—</span></div>
        <div class="health-row"><span class="label">Failed</span><span class="val" id="totFailed">—</span></div>
        <div class="health-row"><span class="label">Queued</span><span class="val" id="totQueued">—</span></div>
        <div class="health-row"><span class="label">Dead-lettered</span><span class="val" id="totDead">—</span></div>
        <div class="health-row"><span class="label">Suppressed/blocked</span><span class="val" id="totSuppBlocked">—</span></div>
      </div>
    </div>
  </div>

  <!-- Subscribers -->
  <div class="section">
    <div class="section-header">
      <div class="section-title">Intelligence Brief Subscribers</div>
    </div>
    <div class="filters">
      <span class="filter-label">Plan:</span>
      <div class="btn-group" id="planFilterGroup">
        <button class="btn btn-ghost btn-sm active" data-plan="all">All</button>
        <button class="btn btn-ghost btn-sm" data-plan="free">Free</button>
        <button class="btn btn-ghost btn-sm" data-plan="professional">Brief Pro</button>
        <button class="btn btn-ghost btn-sm" data-plan="platform">Platform</button>
      </div>
      <span class="filter-label" style="margin-left:8px;">Active:</span>
      <div class="btn-group" id="activeFilterGroup">
        <button class="btn btn-ghost btn-sm active" data-active="all">All</button>
        <button class="btn btn-ghost btn-sm" data-active="true">Active only</button>
        <button class="btn btn-ghost btn-sm" data-active="false">Inactive</button>
      </div>
      <span class="filter-label" style="margin-left:8px;">Suppressed:</span>
      <div class="btn-group" id="suppFilterGroup">
        <button class="btn btn-ghost btn-sm active" data-supp="all">All</button>
        <button class="btn btn-ghost btn-sm" data-supp="true">Suppressed</button>
        <button class="btn btn-ghost btn-sm" data-supp="false">Not suppressed</button>
      </div>
    </div>
    <div class="filters">
      <input type="search" id="subSearch" class="search-input" placeholder="Search email, name, org…" />
      <button class="btn btn-ghost btn-sm" id="subSearchBtn">Search</button>
    </div>
    <div class="tbl-wrap">
      <table id="subTable">
        <thead>
          <tr>
            <th data-col="email" data-section="subs">Email <span class="sort-arrow">↕</span></th>
            <th data-col="name" data-section="subs">Name <span class="sort-arrow">↕</span></th>
            <th data-col="plan" data-section="subs">Plan <span class="sort-arrow">↕</span></th>
            <th data-col="organization_name" data-section="subs">Organization <span class="sort-arrow">↕</span></th>
            <th data-col="subscribed_at" data-section="subs">Subscribed <span class="sort-arrow">↓</span></th>
            <th data-col="last_delivery_at" data-section="subs">Last Delivery <span class="sort-arrow">↕</span></th>
            <th data-col="active" data-section="subs">Active <span class="sort-arrow">↕</span></th>
            <th data-col="email_suppressed" data-section="subs">Suppressed <span class="sort-arrow">↕</span></th>
          </tr>
        </thead>
        <tbody id="subBody"><tr><td colspan="8" class="no-data">Save admin token to load</td></tr></tbody>
      </table>
    </div>
    <div class="pagination">
      <span class="page-info" id="subPageInfo"></span>
      <button class="btn btn-ghost btn-sm" id="subPrev" disabled>&#8592; Prev</button>
      <button class="btn btn-ghost btn-sm" id="subNext" disabled>Next &#8594;</button>
    </div>
  </div>

  <!-- Issues -->
  <div class="section">
    <div class="section-header">
      <div class="section-title">Intelligence Briefs</div>
    </div>
    <div class="filters">
      <span class="filter-label">Status:</span>
      <div class="btn-group" id="issueStatusGroup">
        <button class="btn btn-ghost btn-sm active" data-status="all">All</button>
        <button class="btn btn-ghost btn-sm" data-status="draft">Draft</button>
        <button class="btn btn-ghost btn-sm" data-status="generating">Generating</button>
        <button class="btn btn-ghost btn-sm" data-status="published">Published</button>
        <button class="btn btn-ghost btn-sm" data-status="failed">Failed</button>
      </div>
    </div>
    <div class="tbl-wrap">
      <table id="issueTable">
        <thead>
          <tr>
            <th data-col="created_at" data-section="issues">Created <span class="sort-arrow">↓</span></th>
            <th data-col="period_start" data-section="issues">Period <span class="sort-arrow">↕</span></th>
            <th data-col="status" data-section="issues">Status <span class="sort-arrow">↕</span></th>
            <th data-col="signal_count" data-section="issues">Signals <span class="sort-arrow">↕</span></th>
            <th data-col="organization_name" data-section="issues">Org <span class="sort-arrow">↕</span></th>
            <th data-col="sent_count" data-section="issues">Sent <span class="sort-arrow">↕</span></th>
            <th data-col="failed_count" data-section="issues">Failed <span class="sort-arrow">↕</span></th>
            <th data-col="suppressed_count" data-section="issues">Suppressed <span class="sort-arrow">↕</span></th>
          </tr>
        </thead>
        <tbody id="issueBody"><tr><td colspan="8" class="no-data">Save admin token to load</td></tr></tbody>
      </table>
    </div>
    <div class="pagination">
      <span class="page-info" id="issuePageInfo"></span>
      <button class="btn btn-ghost btn-sm" id="issuePrev" disabled>&#8592; Prev</button>
      <button class="btn btn-ghost btn-sm" id="issueNext" disabled>Next &#8594;</button>
    </div>
  </div>

  <!-- Delivery Metrics -->
  <div class="section">
    <div class="section-header"><div class="section-title">Delivery Metrics (Newsletter)</div></div>
    <div class="tbl-wrap">
      <table id="metricsTable">
        <thead>
          <tr>
            <th data-col="title" data-section="metrics">Title <span class="sort-arrow">↕</span></th>
            <th data-col="issue_status" data-section="metrics">Status <span class="sort-arrow">↕</span></th>
            <th data-col="total_deliveries" data-section="metrics">Total <span class="sort-arrow">↕</span></th>
            <th data-col="sent_count" data-section="metrics">Sent <span class="sort-arrow">↕</span></th>
            <th data-col="failed_count" data-section="metrics">Failed <span class="sort-arrow">↕</span></th>
            <th data-col="dead_lettered_count" data-section="metrics">Dead Lettered <span class="sort-arrow">↕</span></th>
          </tr>
        </thead>
        <tbody id="metricsBody"><tr><td colspan="6" class="no-data">Save admin token to load</td></tr></tbody>
      </table>
    </div>
  </div>

  <!-- Provider Events -->
  <div class="section">
    <div class="section-header"><div class="section-title">Provider Events</div></div>
    <div class="filters">
      <span class="filter-label">Type:</span>
      <div class="btn-group" id="evtTypeGroup">
        <button class="btn btn-ghost btn-sm active" data-type="all">All</button>
        <button class="btn btn-ghost btn-sm" data-type="bounce">Bounce</button>
        <button class="btn btn-ghost btn-sm" data-type="complaint">Complaint</button>
        <button class="btn btn-ghost btn-sm" data-type="delivered">Delivered</button>
        <button class="btn btn-ghost btn-sm" data-type="opened">Opened</button>
      </div>
      <input type="search" id="evtSearch" class="search-input" placeholder="Search email…" />
    </div>
    <div class="tbl-wrap">
      <table id="evtTable">
        <thead>
          <tr>
            <th data-col="created_at" data-section="events">Time <span class="sort-arrow">↓</span></th>
            <th data-col="event_type" data-section="events">Type <span class="sort-arrow">↕</span></th>
            <th data-col="provider" data-section="events">Provider <span class="sort-arrow">↕</span></th>
            <th data-col="email" data-section="events">Email <span class="sort-arrow">↕</span></th>
          </tr>
        </thead>
        <tbody id="evtBody"><tr><td colspan="4" class="no-data">Save admin token to load</td></tr></tbody>
      </table>
    </div>
  </div>

  <!-- Suppressions -->
  <div class="section">
    <div class="section-header"><div class="section-title">Suppression List</div></div>
    <div class="tbl-wrap">
      <table id="suppTable">
        <thead>
          <tr>
            <th data-col="created_at" data-section="supp">Added <span class="sort-arrow">↓</span></th>
            <th data-col="email" data-section="supp">Email <span class="sort-arrow">↕</span></th>
            <th data-col="reason" data-section="supp">Reason <span class="sort-arrow">↕</span></th>
            <th data-col="provider" data-section="supp">Source <span class="sort-arrow">↕</span></th>
          </tr>
        </thead>
        <tbody id="suppBody"><tr><td colspan="4" class="no-data">Save admin token to load</td></tr></tbody>
      </table>
    </div>
  </div>

  <!-- Worker Runs -->
  <div class="section">
    <div class="section-header"><div class="section-title">Recent Worker Runs</div></div>
    <div class="tbl-wrap">
      <table id="workerTable">
        <thead>
          <tr>
            <th data-col="started_at" data-section="workers">Started <span class="sort-arrow">↓</span></th>
            <th data-col="worker_name" data-section="workers">Worker <span class="sort-arrow">↕</span></th>
            <th data-col="status" data-section="workers">Status <span class="sort-arrow">↕</span></th>
            <th data-col="duration_ms" data-section="workers">Duration <span class="sort-arrow">↕</span></th>
          </tr>
        </thead>
        <tbody id="workerBody"><tr><td colspan="4" class="no-data">Save admin token to load</td></tr></tbody>
      </table>
    </div>
  </div>

</div><!-- /page -->

<script>
// ─── Token storage ──────────────────────────────────────────────────────────
var TOKEN_KEY = 'sl_admin_token';
function getToken() {
  return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || '';
}
function saveToken(v) {
  try { localStorage.setItem(TOKEN_KEY, v); } catch(e) {}
  try { sessionStorage.setItem(TOKEN_KEY, v); } catch(e) {}
}
function clearToken() {
  try { localStorage.removeItem(TOKEN_KEY); } catch(e) {}
  try { sessionStorage.removeItem(TOKEN_KEY); } catch(e) {}
}

// ─── UI helpers ─────────────────────────────────────────────────────────────
function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function fmtDate(v) {
  if (!v) return '—';
  try {
    var d = new Date(v);
    return d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'})
      + ' ' + d.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',timeZone:'UTC'});
  } catch(e) { return String(v); }
}
function fmtDateShort(v) {
  if (!v) return '—';
  try {
    var d = new Date(v);
    return d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
  } catch(e) { return String(v); }
}
function fmtDuration(ms) {
  if (ms == null || ms === '') return '—';
  var n = Number(ms);
  if (!Number.isFinite(n)) return String(ms);
  if (n < 1000) return n + 'ms';
  return (n / 1000).toFixed(1) + 's';
}
function planBadge(plan) {
  var p = String(plan || '').toLowerCase();
  if (p === 'professional') return '<span class="badge badge-teal">Brief Pro</span>';
  if (p === 'premium' || p === 'platform') return '<span class="badge badge-blue">Platform Pro</span>';
  if (p === 'team') return '<span class="badge badge-blue">Platform Team</span>';
  return '<span class="badge badge-gray">Free</span>';
}
function statusBadge(s) {
  var st = String(s || '').toLowerCase();
  if (st === 'published' || st === 'sent' || st === 'active') return '<span class="badge badge-green">' + esc(s) + '</span>';
  if (st === 'generating' || st === 'queued') return '<span class="badge badge-amber">' + esc(s) + '</span>';
  if (st === 'failed' || st === 'dead_lettered') return '<span class="badge badge-red">' + esc(s) + '</span>';
  if (st === 'draft') return '<span class="badge badge-gray">' + esc(s) + '</span>';
  return '<span class="badge badge-gray">' + esc(s) + '</span>';
}
function evtTypeBadge(t) {
  var ev = String(t || '').toLowerCase();
  if (ev.includes('bounce')) return '<span class="badge badge-red">' + esc(t) + '</span>';
  if (ev.includes('complaint')) return '<span class="badge badge-red">' + esc(t) + '</span>';
  if (ev.includes('deliver')) return '<span class="badge badge-green">' + esc(t) + '</span>';
  if (ev.includes('open')) return '<span class="badge badge-teal">' + esc(t) + '</span>';
  return '<span class="badge badge-gray">' + esc(t) + '</span>';
}
function yesNo(v) {
  return v ? '<span class="badge badge-green">Yes</span>' : '<span class="badge badge-gray">No</span>';
}
function suppCell(v) {
  return v ? '<span class="badge badge-red">Suppressed</span>' : '';
}

function setMainError(msg) {
  document.getElementById('pageError').textContent = msg || '';
}
function setLastRefresh() {
  document.getElementById('lastRefresh').textContent = 'Refreshed ' + new Date().toLocaleTimeString();
}
function syncTokenUi() {
  var t = getToken();
  document.getElementById('tokenInput').value = t;
  document.getElementById('tokenStatus').textContent = t ? 'Token saved' : 'No token saved';
}

// ─── API ────────────────────────────────────────────────────────────────────
async function api(path) {
  var token = getToken();
  if (!token) throw new Error('Save admin token first.');
  var res = await fetch(path, { method: 'GET', headers: { 'X-Admin-Key': token } });
  var text = await res.text();
  var body;
  try { body = text ? JSON.parse(text) : {}; } catch(e) { body = text; }
  if (!res.ok) {
    throw new Error(path + ' failed (' + res.status + '): ' +
      (typeof body === 'string' ? body : JSON.stringify(body)));
  }
  return body;
}

// ─── Sort state ─────────────────────────────────────────────────────────────
var sortState = {
  subs:    { col: 'subscribed_at', dir: 'desc' },
  issues:  { col: 'created_at',   dir: 'desc' },
  metrics: { col: 'issue_created_at', dir: 'desc' },
  events:  { col: 'created_at',   dir: 'desc' },
  supp:    { col: 'created_at',   dir: 'desc' },
  workers: { col: 'started_at',   dir: 'desc' }
};

// ─── Subscriber state ────────────────────────────────────────────────────────
var subState = {
  plan: 'all', active: 'all', suppressed: 'all',
  search: '', page: 0, perPage: 50,
  total: 0, rows: []
};

// ─── Issues state ────────────────────────────────────────────────────────────
var issueState = {
  status: 'all', page: 0, perPage: 25,
  total: 0, rows: []
};

// ─── Cached data for client-side sort ────────────────────────────────────────
var cache = { metrics: [], events: [], supp: [], workers: [] };

// ─── Sort helpers ────────────────────────────────────────────────────────────
function sortRows(rows, col, dir) {
  if (!col) return rows;
  return rows.slice().sort(function(a, b) {
    var va = a[col], vb = b[col];
    if (va == null && vb == null) return 0;
    if (va == null) return dir === 'asc' ? 1 : -1;
    if (vb == null) return dir === 'asc' ? -1 : 1;
    if (typeof va === 'number' && typeof vb === 'number') {
      return dir === 'asc' ? va - vb : vb - va;
    }
    var sa = String(va).toLowerCase(), sb = String(vb).toLowerCase();
    if (sa < sb) return dir === 'asc' ? -1 : 1;
    if (sa > sb) return dir === 'asc' ? 1 : -1;
    return 0;
  });
}

function updateSortHeaders(tableId, section) {
  var tbl = document.getElementById(tableId);
  if (!tbl) return;
  var state = sortState[section];
  tbl.querySelectorAll('thead th').forEach(function(th) {
    var col = th.getAttribute('data-col');
    var arrow = th.querySelector('.sort-arrow');
    if (!arrow) return;
    th.classList.remove('sorted');
    if (col === state.col) {
      th.classList.add('sorted');
      arrow.textContent = state.dir === 'asc' ? '↑' : '↓';
    } else {
      arrow.textContent = '↕';
    }
  });
}

function handleSortClick(section, col, refreshFn) {
  var state = sortState[section];
  if (state.col === col) {
    state.dir = state.dir === 'asc' ? 'desc' : 'asc';
  } else {
    state.col = col;
    state.dir = 'asc';
  }
  refreshFn();
}

// Wire sort clicks on all tables
document.querySelectorAll('thead th[data-section]').forEach(function(th) {
  th.addEventListener('click', function() {
    var section = th.getAttribute('data-section');
    var col = th.getAttribute('data-col');
    if (!section || !col) return;
    var refreshMap = {
      subs:    function() { fetchSubscribers(); },
      issues:  function() { fetchIssues(); },
      metrics: function() { renderMetrics(); },
      events:  function() { renderEvents(); },
      supp:    function() { renderSupp(); },
      workers: function() { renderWorkers(); }
    };
    handleSortClick(section, col, refreshMap[section] || function(){});
  });
});

// ─── Render: subscribers ─────────────────────────────────────────────────────
function renderSubscriberRows(rows) {
  var sorted = sortRows(rows, sortState.subs.col, sortState.subs.dir);
  var html = '';
  if (!sorted.length) {
    html = '<tr><td colspan="8" class="no-data">No subscribers found</td></tr>';
  } else {
    for (var i = 0; i < sorted.length; i++) {
      var r = sorted[i];
      var supp = r.email_suppressed;
      var emailCls = supp ? ' class="primary suppressed"' : ' class="primary"';
      html += '<tr>';
      html += '<td' + emailCls + '>' + esc(r.email) + '</td>';
      html += '<td>' + esc(r.name || '—') + '</td>';
      html += '<td>' + planBadge(r.plan) + '</td>';
      html += '<td>' + esc(r.organization_name || '—') + '</td>';
      html += '<td class="muted">' + fmtDateShort(r.subscribed_at) + '</td>';
      html += '<td class="muted">' + fmtDateShort(r.last_delivery_at) + '</td>';
      html += '<td>' + yesNo(r.active) + '</td>';
      html += '<td>' + suppCell(supp) + '</td>';
      html += '</tr>';
    }
  }
  document.getElementById('subBody').innerHTML = html;
  updateSortHeaders('subTable', 'subs');
}

async function fetchSubscribers() {
  var params = new URLSearchParams();
  params.set('limit', String(subState.perPage));
  params.set('offset', String(subState.page * subState.perPage));
  if (subState.plan !== 'all') params.set('plan', subState.plan);
  if (subState.active !== 'all') params.set('active', subState.active);
  if (subState.suppressed !== 'all') params.set('suppressed', subState.suppressed);
  if (subState.search) params.set('search', subState.search);

  try {
    var data = await api('/admin/brief-subscribers?' + params.toString());
    subState.total = Number(data.total || 0);
    subState.rows  = data.subscribers || [];
    renderSubscriberRows(subState.rows);
    updateSubPagination();
  } catch(err) {
    document.getElementById('subBody').innerHTML =
      '<tr><td colspan="8" class="no-data" style="color:#f87171;">' + esc(String(err.message || err)) + '</td></tr>';
  }
}

function updateSubPagination() {
  var from = subState.page * subState.perPage + 1;
  var to   = Math.min(from + subState.rows.length - 1, subState.total);
  document.getElementById('subPageInfo').textContent =
    subState.total === 0 ? 'No results' : ('Showing ' + from + '–' + to + ' of ' + subState.total);
  document.getElementById('subPrev').disabled = subState.page === 0;
  document.getElementById('subNext').disabled = to >= subState.total;
}

// ─── Render: issues ──────────────────────────────────────────────────────────
function renderIssueRows(rows) {
  var sorted = sortRows(rows, sortState.issues.col, sortState.issues.dir);
  var html = '';
  if (!sorted.length) {
    html = '<tr><td colspan="8" class="no-data">No briefs found</td></tr>';
  } else {
    for (var i = 0; i < sorted.length; i++) {
      var r = sorted[i];
      var period = fmtDateShort(r.period_start) + ' – ' + fmtDateShort(r.period_end);
      html += '<tr>';
      html += '<td class="muted">' + fmtDateShort(r.created_at) + '</td>';
      html += '<td class="primary">' + esc(period) + '</td>';
      html += '<td>' + statusBadge(r.status) + '</td>';
      html += '<td>' + esc(r.signal_count != null ? r.signal_count : '—') + '</td>';
      html += '<td>' + esc(r.organization_name || '—') + '</td>';
      html += '<td>' + esc(r.sent_count != null ? r.sent_count : 0) + '</td>';
      html += '<td>' + (Number(r.failed_count) > 0 ? '<span style="color:#f87171;">' + esc(r.failed_count) + '</span>' : '0') + '</td>';
      html += '<td>' + (Number(r.suppressed_count) > 0 ? '<span style="color:#f59e0b;">' + esc(r.suppressed_count) + '</span>' : '0') + '</td>';
      html += '</tr>';
    }
  }
  document.getElementById('issueBody').innerHTML = html;
  updateSortHeaders('issueTable', 'issues');
}

async function fetchIssues() {
  var params = new URLSearchParams();
  params.set('limit', String(issueState.perPage));
  params.set('offset', String(issueState.page * issueState.perPage));
  if (issueState.status !== 'all') params.set('status', issueState.status);

  try {
    var data = await api('/admin/issues?' + params.toString());
    issueState.total = Number(data.total || 0);
    issueState.rows  = data.issues || [];
    renderIssueRows(issueState.rows);
    updateIssuePagination();
  } catch(err) {
    document.getElementById('issueBody').innerHTML =
      '<tr><td colspan="8" class="no-data" style="color:#f87171;">' + esc(String(err.message || err)) + '</td></tr>';
  }
}

function updateIssuePagination() {
  var from = issueState.page * issueState.perPage + 1;
  var to   = Math.min(from + issueState.rows.length - 1, issueState.total);
  document.getElementById('issuePageInfo').textContent =
    issueState.total === 0 ? 'No results' : ('Showing ' + from + '–' + to + ' of ' + issueState.total);
  document.getElementById('issuePrev').disabled = issueState.page === 0;
  document.getElementById('issueNext').disabled = to >= issueState.total;
}

// ─── Render: delivery metrics ────────────────────────────────────────────────
function renderMetrics() {
  var rows = sortRows(cache.metrics, sortState.metrics.col, sortState.metrics.dir);
  var html = '';
  if (!rows.length) {
    html = '<tr><td colspan="6" class="no-data">No data</td></tr>';
  } else {
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      html += '<tr>';
      html += '<td class="primary">' + esc(r.title || '—') + '</td>';
      html += '<td>' + statusBadge(r.issue_status) + '</td>';
      html += '<td>' + esc(r.total_deliveries != null ? r.total_deliveries : 0) + '</td>';
      html += '<td>' + esc(r.sent_count != null ? r.sent_count : 0) + '</td>';
      html += '<td>' + (Number(r.failed_count) > 0 ? '<span style="color:#f87171;">' + esc(r.failed_count) + '</span>' : '0') + '</td>';
      html += '<td>' + (Number(r.dead_lettered_count) > 0 ? '<span style="color:#f87171;">' + esc(r.dead_lettered_count) + '</span>' : '0') + '</td>';
      html += '</tr>';
    }
  }
  document.getElementById('metricsBody').innerHTML = html;
  updateSortHeaders('metricsTable', 'metrics');
}

// ─── Render: events ──────────────────────────────────────────────────────────
var evtFilter = 'all';
var evtSearch = '';

function renderEvents() {
  var rows = cache.events.filter(function(r) {
    var t = String(r.event_type || '').toLowerCase();
    if (evtFilter !== 'all' && !t.includes(evtFilter)) return false;
    if (evtSearch) {
      var em = String(r.email || '').toLowerCase();
      if (!em.includes(evtSearch)) return false;
    }
    return true;
  });
  rows = sortRows(rows, sortState.events.col, sortState.events.dir);
  var html = '';
  if (!rows.length) {
    html = '<tr><td colspan="4" class="no-data">No events</td></tr>';
  } else {
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      html += '<tr>';
      html += '<td class="muted">' + fmtDate(r.created_at) + '</td>';
      html += '<td>' + evtTypeBadge(r.event_type) + '</td>';
      html += '<td class="muted">' + esc(r.provider || '—') + '</td>';
      html += '<td class="primary">' + esc(r.email || '—') + '</td>';
      html += '</tr>';
    }
  }
  document.getElementById('evtBody').innerHTML = html;
  updateSortHeaders('evtTable', 'events');
}

// ─── Render: suppressions ────────────────────────────────────────────────────
function renderSupp() {
  var rows = sortRows(cache.supp, sortState.supp.col, sortState.supp.dir);
  var html = '';
  if (!rows.length) {
    html = '<tr><td colspan="4" class="no-data">No suppressions</td></tr>';
  } else {
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      html += '<tr>';
      html += '<td class="muted">' + fmtDate(r.created_at) + '</td>';
      html += '<td class="primary suppressed">' + esc(r.email) + '</td>';
      html += '<td class="muted">' + esc(r.reason || '—') + '</td>';
      html += '<td class="muted">' + esc(r.provider || '—') + '</td>';
      html += '</tr>';
    }
  }
  document.getElementById('suppBody').innerHTML = html;
  updateSortHeaders('suppTable', 'supp');
}

// ─── Render: workers ─────────────────────────────────────────────────────────
function renderWorkers() {
  var rows = sortRows(cache.workers, sortState.workers.col, sortState.workers.dir);
  var html = '';
  if (!rows.length) {
    html = '<tr><td colspan="4" class="no-data">No worker runs</td></tr>';
  } else {
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      html += '<tr>';
      html += '<td class="muted">' + fmtDate(r.started_at) + '</td>';
      html += '<td class="primary">' + esc(r.worker_name || '—') + '</td>';
      html += '<td>' + statusBadge(r.status) + '</td>';
      html += '<td class="muted">' + fmtDuration(r.duration_ms) + '</td>';
      html += '</tr>';
    }
  }
  document.getElementById('workerBody').innerHTML = html;
  updateSortHeaders('workerTable', 'workers');
}

// ─── Load: health ─────────────────────────────────────────────────────────────
async function loadHealth() {
  try {
    var data = await api('/admin/ops/health');
    var h = data.health;
    var el = document.getElementById('healthStatus');
    var st = String(h.status || '').toUpperCase();
    el.textContent = st;
    el.className = 'health-status ' + (h.status === 'healthy' ? 'healthy' : h.status === 'degraded' ? 'degraded' : 'failing');
    document.getElementById('healthDead').textContent = h.deadLetterCount != null ? h.deadLetterCount : '—';
    document.getElementById('healthWorkerFails').textContent = h.failedWorkerRunsLast24h != null ? h.failedWorkerRunsLast24h : '—';
    document.getElementById('healthQueued').textContent = h.queuedDeliveriesCount != null ? h.queuedDeliveriesCount : '—';
    document.getElementById('healthSuppPaying').textContent = h.suppressedPayingCount != null ? h.suppressedPayingCount : '0';
    var reasons = document.getElementById('healthReasons');
    if (h.reasons && h.reasons.length) {
      reasons.innerHTML = h.reasons.map(function(r) { return '⚠ ' + esc(r); }).join('<br>');
    } else {
      reasons.textContent = '';
    }
  } catch(err) {
    document.getElementById('healthStatus').textContent = 'ERROR';
    document.getElementById('healthStatus').className = 'health-status failing';
    setMainError('Health: ' + String(err.message || err));
  }
}

// ─── Load: summary ────────────────────────────────────────────────────────────
async function loadSummary() {
  try {
    var data = await api('/admin/brief-subscribers/summary');
    document.getElementById('statActive').textContent = data.total_active != null ? data.total_active : '—';
    document.getElementById('statFree').textContent = data.by_plan ? (data.by_plan.free != null ? data.by_plan.free : '—') : '—';
    document.getElementById('statPro').textContent = data.by_plan ? (data.by_plan.professional != null ? data.by_plan.professional : '—') : '—';
    document.getElementById('statPlatform').textContent = data.by_plan ? (data.by_plan.platform != null ? data.by_plan.platform : '—') : '—';
    document.getElementById('statNew7d').textContent = data.new_last_7_days != null ? data.new_last_7_days : '—';
    document.getElementById('statNew30d').textContent = data.new_last_30_days != null ? ('+' + data.new_last_30_days + ' last 30d') : '';
    var suppCount = Number(data.suppressed_count || 0);
    document.getElementById('statSupp').textContent = suppCount;
    var suppCard = document.getElementById('statSuppCard');
    if (suppCount > 0) {
      suppCard.classList.add('danger');
    } else {
      suppCard.classList.remove('danger');
    }
  } catch(err) {
    // summary failure is non-fatal
  }
}

// ─── Load: overview (delivery totals + events + workers) ──────────────────────
async function loadOverview() {
  try {
    var data = await api('/admin/ops/overview');
    var o = data.overview;
    // delivery totals
    var dt = o.deliveryTotals || {};
    document.getElementById('totSent').textContent = dt.sent_count != null ? dt.sent_count : '—';
    document.getElementById('totFailed').textContent = dt.failed_count != null ? dt.failed_count : '—';
    document.getElementById('totQueued').textContent = dt.queued_count != null ? dt.queued_count : '—';
    document.getElementById('totDead').textContent = dt.dead_lettered_count != null ? dt.dead_lettered_count : '—';
    document.getElementById('totSuppBlocked').textContent = dt.suppressed_blocked_count != null ? dt.suppressed_blocked_count : '—';
    // cache events + workers
    cache.events = o.recentProviderEvents || [];
    cache.workers = o.recentWorkerRuns || [];
    renderEvents();
    renderWorkers();
  } catch(err) {
    setMainError('Overview: ' + String(err.message || err));
  }
}

// ─── Load: delivery metrics ───────────────────────────────────────────────────
async function loadMetrics() {
  try {
    var data = await api('/admin/delivery-metrics?limit=10');
    cache.metrics = data.metrics || [];
    renderMetrics();
  } catch(err) {
    document.getElementById('metricsBody').innerHTML =
      '<tr><td colspan="6" class="no-data" style="color:#f87171;">' + esc(String(err.message || err)) + '</td></tr>';
  }
}

// ─── Load: suppressions ───────────────────────────────────────────────────────
async function loadSuppressions() {
  try {
    var data = await api('/admin/suppressions');
    cache.supp = data.suppressions || [];
    renderSupp();
  } catch(err) {
    document.getElementById('suppBody').innerHTML =
      '<tr><td colspan="4" class="no-data" style="color:#f87171;">' + esc(String(err.message || err)) + '</td></tr>';
  }
}

// ─── Load all ─────────────────────────────────────────────────────────────────
async function loadAll() {
  setMainError('');
  await Promise.allSettled([
    loadHealth(),
    loadSummary(),
    fetchSubscribers(),
    fetchIssues(),
    loadOverview(),
    loadMetrics(),
    loadSuppressions()
  ]);
  setLastRefresh();
}

// ─── Auto-refresh ─────────────────────────────────────────────────────────────
var autoRefreshId = null;
document.getElementById('autoRefreshToggle').addEventListener('change', function() {
  if (this.checked) {
    autoRefreshId = setInterval(function() { if (getToken()) loadAll(); }, 30000);
  } else {
    if (autoRefreshId) clearInterval(autoRefreshId);
    autoRefreshId = null;
  }
});

// ─── Plan filter buttons ──────────────────────────────────────────────────────
document.getElementById('planFilterGroup').addEventListener('click', function(e) {
  var btn = e.target.closest('[data-plan]');
  if (!btn) return;
  this.querySelectorAll('[data-plan]').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
  subState.plan = btn.getAttribute('data-plan');
  subState.page = 0;
  fetchSubscribers();
});

document.getElementById('activeFilterGroup').addEventListener('click', function(e) {
  var btn = e.target.closest('[data-active]');
  if (!btn) return;
  this.querySelectorAll('[data-active]').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
  subState.active = btn.getAttribute('data-active');
  subState.page = 0;
  fetchSubscribers();
});

document.getElementById('suppFilterGroup').addEventListener('click', function(e) {
  var btn = e.target.closest('[data-supp]');
  if (!btn) return;
  this.querySelectorAll('[data-supp]').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
  subState.suppressed = btn.getAttribute('data-supp');
  subState.page = 0;
  fetchSubscribers();
});

// Subscriber search
document.getElementById('subSearchBtn').addEventListener('click', function() {
  subState.search = document.getElementById('subSearch').value.trim();
  subState.page = 0;
  fetchSubscribers();
});
document.getElementById('subSearch').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') {
    subState.search = this.value.trim();
    subState.page = 0;
    fetchSubscribers();
  }
});

// Subscriber pagination
document.getElementById('subPrev').addEventListener('click', function() {
  if (subState.page > 0) { subState.page--; fetchSubscribers(); }
});
document.getElementById('subNext').addEventListener('click', function() {
  var maxPage = Math.ceil(subState.total / subState.perPage) - 1;
  if (subState.page < maxPage) { subState.page++; fetchSubscribers(); }
});

// ─── Issue status filter ──────────────────────────────────────────────────────
document.getElementById('issueStatusGroup').addEventListener('click', function(e) {
  var btn = e.target.closest('[data-status]');
  if (!btn) return;
  this.querySelectorAll('[data-status]').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
  issueState.status = btn.getAttribute('data-status');
  issueState.page = 0;
  fetchIssues();
});

// Issue pagination
document.getElementById('issuePrev').addEventListener('click', function() {
  if (issueState.page > 0) { issueState.page--; fetchIssues(); }
});
document.getElementById('issueNext').addEventListener('click', function() {
  var maxPage = Math.ceil(issueState.total / issueState.perPage) - 1;
  if (issueState.page < maxPage) { issueState.page++; fetchIssues(); }
});

// ─── Event type filter ────────────────────────────────────────────────────────
document.getElementById('evtTypeGroup').addEventListener('click', function(e) {
  var btn = e.target.closest('[data-type]');
  if (!btn) return;
  this.querySelectorAll('[data-type]').forEach(function(b) { b.classList.remove('active'); });
  btn.classList.add('active');
  evtFilter = btn.getAttribute('data-type');
  renderEvents();
});
document.getElementById('evtSearch').addEventListener('input', function() {
  evtSearch = this.value.trim().toLowerCase();
  renderEvents();
});

// ─── Token controls ───────────────────────────────────────────────────────────
document.getElementById('saveTokenBtn').addEventListener('click', function() {
  var v = document.getElementById('tokenInput').value.trim();
  if (!v) return;
  saveToken(v);
  syncTokenUi();
  setMainError('');
  loadAll();
});
document.getElementById('clearTokenBtn').addEventListener('click', function() {
  clearToken();
  syncTokenUi();
  setMainError('');
});
document.getElementById('toggleTokenBtn').addEventListener('click', function() {
  var inp = document.getElementById('tokenInput');
  if (inp.type === 'password') { inp.type = 'text'; this.textContent = 'Hide'; }
  else { inp.type = 'password'; this.textContent = 'Show'; }
});
document.getElementById('refreshBtn').addEventListener('click', function() {
  if (getToken()) loadAll();
});

// ─── Init ─────────────────────────────────────────────────────────────────────
syncTokenUi();
if (getToken()) loadAll();
</script>
</body>
</html>`);
});

export default router;
