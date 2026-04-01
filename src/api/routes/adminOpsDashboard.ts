import { Router } from "express";

const router = Router();

router.get("/", (_req, res) => {
  res.status(200).type("html").send(`
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>SecureLogic Ops Dashboard</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    body {
      font-family: Arial, sans-serif;
      margin: 24px;
      background: #0b1020;
      color: #f3f4f6;
    }
    h1, h2 { margin-bottom: 8px; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .card {
      background: #111827;
      border: 1px solid #374151;
      border-radius: 10px;
      padding: 16px;
    }
    .healthy { color: #22c55e; }
    .degraded { color: #f59e0b; }
    .failing { color: #ef4444; }
    .muted { color: #9ca3af; font-size: 13px; }
    .error {
      color: #ef4444;
      margin-top: 12px;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .row {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }
    input[type="password"], input[type="text"] {
      background: #0f172a;
      color: #f3f4f6;
      border: 1px solid #374151;
      border-radius: 8px;
      padding: 10px 12px;
      min-width: 320px;
      width: min(100%, 520px);
    }
    button {
      background: #2563eb;
      color: white;
      border: 0;
      border-radius: 8px;
      padding: 10px 14px;
      cursor: pointer;
      font-weight: 600;
    }
    button.secondary {
      background: #374151;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 8px;
      background: #111827;
    }
    th, td {
      border: 1px solid #374151;
      padding: 8px;
      text-align: left;
      vertical-align: top;
      font-size: 14px;
    }
    th { background: #1f2937; }
  </style>
</head>
<body>
  <h1>SecureLogic Ops Dashboard</h1>
  <p class="muted">Token-based operator view for newsletter delivery health and system activity.</p>

  <div class="card" style="margin-bottom:16px;">
    <h2>Admin Token</h2>
    <div class="row">
      <input id="adminTokenInput" type="password" placeholder="Paste SecureLogic admin token" />
      <button id="saveTokenBtn">Save Token</button>
      <button id="toggleTokenBtn" class="secondary">Show</button>
      <button id="refreshBtn">Refresh</button>
      <button id="clearTokenBtn" class="secondary">Clear Token</button>
    </div>
    <div id="tokenStatus" class="muted">No admin token saved</div>
    <div id="lastRefresh" class="muted"></div>
    <div id="pageError" class="error"></div>
  </div>

  <div class="grid">
    <div class="card">
      <h2>Health</h2>
      <div>Status: <strong id="healthStatus">-</strong></div>
      <div>Dead letters: <strong id="deadLetters">-</strong></div>
      <div>Worker failures (24h): <strong id="workerFailures">-</strong></div>
      <div>Queued deliveries: <strong id="queuedDeliveries">-</strong></div>
      <div class="muted" id="healthReasons"></div>
    </div>

    <div class="card">
      <h2>Delivery Totals</h2>
      <div>Sent: <strong id="sentCount">-</strong></div>
      <div>Failed: <strong id="failedCount">-</strong></div>
      <div>Queued: <strong id="queuedCount">-</strong></div>
      <div>Dead-lettered: <strong id="deadLetteredCount">-</strong></div>
      <div>Suppressed blocked: <strong id="suppressedBlockedCount">-</strong></div>
    </div>

    <div class="card">
      <h2>Suppressions</h2>
      <div>Total suppressions: <strong id="suppressionCount">-</strong></div>
    </div>

    <div class="card">
      <h2>Latest Issue</h2>
      <div id="latestIssue">-</div>
    </div>
  </div>

  <div class="card">
    <h2>Recent Issues</h2>
    <div id="issues"></div>
  </div>

  <br />

  <div class="card">
    <h2>Recent Provider Events</h2>
    <div id="events"></div>
  </div>

  <br />

  <div class="card">
    <h2>Recent Worker Runs</h2>
    <div id="workerRuns"></div>
  </div>

  <br />

  <div class="card">
    <h2>Delivery Metrics by Issue</h2>
    <div id="metrics"></div>
  </div>

  <script>
    function escapeHtml(value) {
      return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function getAdminToken() {
      return localStorage.getItem("securelogic_admin_token") || "";
    }

    function setAdminToken(token) {
      localStorage.setItem("securelogic_admin_token", token);
      syncTokenUi();
    }

    function clearAdminToken() {
      localStorage.removeItem("securelogic_admin_token");
      syncTokenUi();
    }

    function syncTokenUi() {
      const token = getAdminToken();
      const input = document.getElementById("adminTokenInput");
      const status = document.getElementById("tokenStatus");

      input.value = token;
      status.textContent = token
        ? "Admin token saved in localStorage"
        : "No admin token saved";
    }

    function setError(message) {
      document.getElementById("pageError").textContent = message || "";
    }

    function setLastRefresh() {
      document.getElementById("lastRefresh").textContent =
        "Last refreshed: " + new Date().toLocaleString();
    }

    function applyHealthClass(el, status) {
      el.className =
        status === "healthy" ? "healthy" :
        status === "degraded" ? "degraded" :
        status === "failing" ? "failing" : "";
    }

    async function fetchJson(path) {
      const token = getAdminToken();

      if (!token) {
        throw new Error("Save the admin token first.");
      }

      const res = await fetch(path, {
        method: "GET",
        headers: {
          "Authorization": "Bearer " + token
        }
      });

      const text = await res.text();
      let body;

      try {
        body = text ? JSON.parse(text) : {};
      } catch {
        body = text;
      }

      if (!res.ok) {
        console.error("API ERROR:", path, res.status, body);
        throw new Error(
          path + " failed (" + res.status + "): " +
          (typeof body === "string" ? body : JSON.stringify(body))
        );
      }

      return body;
    }

    function renderTable(rows, columns) {
      if (!rows || rows.length === 0) {
        return "<div class='muted'>No data</div>";
      }

      const thead = "<tr>" + columns.map(c => "<th>" + escapeHtml(c.label) + "</th>").join("") + "</tr>";
      const tbody = rows.map((row) =>
        "<tr>" +
        columns.map((c) => {
          const raw = typeof c.render === "function" ? c.render(row) : row[c.key];
          return "<td>" + escapeHtml(raw ?? "") + "</td>";
        }).join("") +
        "</tr>"
      ).join("");

      return "<table><thead>" + thead + "</thead><tbody>" + tbody + "</tbody></table>";
    }

    async function load() {
  setError("");

  let health;
  try {
    health = await fetchJson("/admin/ops/health");

    const h = health.health;

    const healthStatusEl = document.getElementById("healthStatus");
    healthStatusEl.textContent = String(h.status || "").toUpperCase();
    applyHealthClass(healthStatusEl, h.status);

    document.getElementById("deadLetters").textContent = String(h.deadLetterCount ?? 0);
    document.getElementById("workerFailures").textContent = String(h.failedWorkerRunsLast24h ?? 0);
    document.getElementById("queuedDeliveries").textContent = String(h.queuedDeliveriesCount ?? 0);
    document.getElementById("healthReasons").textContent =
      h.reasons && h.reasons.length ? h.reasons.join(", ") : "No active health warnings";

  } catch (err) {
    setError("Health failed: " + String(err.message || err));
    return;
  }

  // OVERVIEW (can fail independently)
  try {
    const overview = await fetchJson("/admin/ops/overview");
    const o = overview.overview;
    const deliveryTotals = o.deliveryTotals || {};

    document.getElementById("sentCount").textContent = String(deliveryTotals.sent_count ?? 0);
    document.getElementById("failedCount").textContent = String(deliveryTotals.failed_count ?? 0);
    document.getElementById("queuedCount").textContent = String(deliveryTotals.queued_count ?? 0);
    document.getElementById("deadLetteredCount").textContent = String(deliveryTotals.dead_lettered_count ?? 0);
    document.getElementById("suppressedBlockedCount").textContent = String(deliveryTotals.suppressed_blocked_count ?? 0);
    document.getElementById("suppressionCount").textContent = String(o.suppressionCount ?? 0);

    document.getElementById("latestIssue").textContent =
      o.recentIssues && o.recentIssues.length
        ? o.recentIssues[0].title + " (" + o.recentIssues[0].status + ")"
        : "No issues found";

    document.getElementById("issues").innerHTML = renderTable(o.recentIssues, [
      { key: "id", label: "Issue ID" },
      { key: "title", label: "Title" },
      { key: "status", label: "Status" },
      { key: "created_at", label: "Created At" }
    ]);

    document.getElementById("events").innerHTML = renderTable(o.recentProviderEvents, [
      { key: "provider", label: "Provider" },
      { key: "provider_event_id", label: "Provider Event ID" },
      { key: "event_type", label: "Event Type" },
      { key: "email", label: "Email" },
      { key: "created_at", label: "Created At" }
    ]);

    document.getElementById("workerRuns").innerHTML = renderTable(o.recentWorkerRuns, [
      { key: "worker_name", label: "Worker" },
      { key: "status", label: "Status" },
      { key: "started_at", label: "Started" },
      { key: "completed_at", label: "Completed" },
      { key: "duration_ms", label: "Duration (ms)" },
      {
        key: "metadata",
        label: "Metadata",
        render: (row) => JSON.stringify(row.metadata ?? {})
      }
    ]);

  } catch (err) {
    console.error("OVERVIEW FAILED:", err);
    setError("Overview failed: " + String(err.message || err));
  }

  // METRICS (independent)
  try {
    const metrics = await fetchJson("/admin/delivery-metrics?limit=10");

    document.getElementById("metrics").innerHTML = renderTable(
      metrics.metrics,
      [
        { key: "issue_id", label: "Issue ID" },
        { key: "title", label: "Title" },
        { key: "issue_status", label: "Issue Status" },
        { key: "total_deliveries", label: "Total" },
        { key: "queued_count", label: "Queued" },
        { key: "sent_count", label: "Sent" },
        { key: "failed_count", label: "Failed" },
        { key: "dead_lettered_count", label: "Dead Lettered" },
        { key: "suppressed_blocked_count", label: "Suppressed" }
      ]
    );

  } catch (err) {
    console.error("METRICS FAILED:", err);
    setError("Metrics failed: " + String(err.message || err));
  }

  setLastRefresh();
}

    document.getElementById("saveTokenBtn").addEventListener("click", () => {
      const value = document.getElementById("adminTokenInput").value.trim();
      setAdminToken(value);
      setError("");
      load().catch(err => setError(err.message));
    });

    document.getElementById("clearTokenBtn").addEventListener("click", () => {
      clearAdminToken();
      setError("");
    });

    document.getElementById("refreshBtn").addEventListener("click", () => {
      load().catch(err => setError(err.message));
    });

    document.getElementById("toggleTokenBtn").addEventListener("click", () => {
      const input = document.getElementById("adminTokenInput");
      const btn = document.getElementById("toggleTokenBtn");

      if (input.type === "password") {
        input.type = "text";
        btn.textContent = "Hide";
      } else {
        input.type = "password";
        btn.textContent = "Show";
      }
    });

    syncTokenUi();
    if (getAdminToken()) {
      load().catch(err => setError(err.message));
    }
  </script>
</body>
</html>
  `);
});

export default router;