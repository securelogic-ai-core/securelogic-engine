import { Router } from "express"

const router = Router()

router.get("/ops/dashboard", (_req, res) => {
  res
    .status(200)
    .type("html")
    .send(`<!doctype html>
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
    h1, h2 {
      margin-bottom: 8px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
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
    th {
      background: #1f2937;
    }
    code, pre {
      white-space: pre-wrap;
      word-break: break-word;
    }
    .muted {
      color: #9ca3af;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <h1>SecureLogic Ops Dashboard</h1>
  <p class="muted">Operator view for newsletter delivery health and recent system activity.</p>

  <div class="grid">
    <div class="card">
      <h2>Health</h2>
      <div id="healthStatus">Loading...</div>
      <div id="healthReasons" class="muted"></div>
    </div>

    <div class="card">
      <h2>Delivery Totals</h2>
      <div id="deliveryTotals">Loading...</div>
    </div>

    <div class="card">
      <h2>Dead Letters / Suppressions</h2>
      <div id="deadLetters">Loading...</div>
      <div id="suppressions">Loading...</div>
    </div>

    <div class="card">
      <h2>Workers</h2>
      <div id="workers">Loading...</div>
    </div>
  </div>

  <div class="card">
    <h2>Recent Issues</h2>
    <div id="issues">Loading...</div>
  </div>

  <br />

  <div class="card">
    <h2>Recent Provider Events</h2>
    <div id="events">Loading...</div>
  </div>

  <br />

  <div class="card">
    <h2>Delivery Metrics by Issue</h2>
    <div id="metrics">Loading...</div>
  </div>

  <script>
    async function fetchJson(path) {
      const res = await fetch(path, {
        headers: {
          "X-Admin-Key": localStorage.getItem("securelogic_admin_key") || ""
        }
      })

      if (!res.ok) {
        const text = await res.text()
        throw new Error(path + " failed: " + text)
      }

      return res.json()
    }

    function renderTable(rows, columns) {
      if (!rows || rows.length === 0) return "<div class='muted'>No data</div>"

      const thead = "<tr>" + columns.map(c => "<th>" + c.label + "</th>").join("") + "</tr>"
      const tbody = rows.map(row =>
        "<tr>" +
        columns.map(c => "<td>" + (row[c.key] ?? "") + "</td>").join("") +
        "</tr>"
      ).join("")

      return "<table><thead>" + thead + "</thead><tbody>" + tbody + "</tbody></table>"
    }

    async function load() {
      const key = localStorage.getItem("securelogic_admin_key")
      if (!key) {
        const entered = prompt("Enter SecureLogic admin key")
        if (entered) {
          localStorage.setItem("securelogic_admin_key", entered)
        }
      }

      const [health, overview, metrics] = await Promise.all([
        fetchJson("/admin/ops/health"),
        fetchJson("/admin/ops/overview"),
        fetchJson("/admin/delivery-metrics")
      ])

      const h = health.health
      document.getElementById("healthStatus").innerHTML =
        "<strong class='" + h.status + "'>" + h.status.toUpperCase() + "</strong>"
      document.getElementById("healthReasons").textContent =
        h.reasons && h.reasons.length ? h.reasons.join(", ") : "No active health warnings"

      document.getElementById("deliveryTotals").innerHTML =
        "<div>Total: <strong>" + overview.overview.deliveryTotals.total_deliveries + "</strong></div>" +
        "<div>Queued: <strong>" + overview.overview.deliveryTotals.queued_count + "</strong></div>" +
        "<div>Sent: <strong>" + overview.overview.deliveryTotals.sent_count + "</strong></div>" +
        "<div>Failed: <strong>" + overview.overview.deliveryTotals.failed_count + "</strong></div>"

      document.getElementById("deadLetters").innerHTML =
        "Dead letters: <strong>" + overview.overview.deadLetterCount + "</strong>"

      document.getElementById("suppressions").innerHTML =
        "Suppressions: <strong>" + overview.overview.suppressionCount + "</strong>"

      document.getElementById("workers").innerHTML =
        "<div>Failed runs (24h): <strong>" + h.failedWorkerRunsLast24h + "</strong></div>" +
        "<div>Stale running: <strong>" + h.staleRunningWorkers + "</strong></div>"

      document.getElementById("issues").innerHTML = renderTable(
        overview.overview.recentIssues,
        [
          { key: "id", label: "Issue ID" },
          { key: "title", label: "Title" },
          { key: "status", label: "Status" },
          { key: "created_at", label: "Created At" }
        ]
      )

      document.getElementById("events").innerHTML = renderTable(
        overview.overview.recentProviderEvents,
        [
          { key: "provider", label: "Provider" },
          { key: "event_type", label: "Event Type" },
          { key: "email", label: "Email" },
          { key: "created_at", label: "Created At" }
        ]
      )

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
      )
    }

    load().catch(err => {
      document.body.innerHTML += "<pre style='color:#ef4444'>" + err.message + "</pre>"
    })
  </script>
</body>
</html>`)
})

export default router
