import { Router } from "express";

const router = Router();

router.get("/admin/login-page", (_req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>SecureLogic Ops Dashboard</title>
  <style>
    body {
      font-family: Arial;
      background: #0b1220;
      color: white;
      padding: 20px;
    }

    input {
      padding: 8px;
      margin: 5px;
    }

    button {
      padding: 8px 12px;
      margin: 5px;
      cursor: pointer;
    }

    .card {
      border: 1px solid #333;
      padding: 15px;
      margin-top: 20px;
      border-radius: 8px;
    }

    .row {
      display: flex;
      gap: 20px;
    }
  </style>
</head>
<body>

<h1>SecureLogic Ops Dashboard</h1>

<div class="card">
  <h2>Admin Login</h2>
  <input id="email" value="admin@securelogic.ai"/>
  <input id="password" type="password"/>
  <br/>
  <button onclick="login()">Login</button>
  <button onclick="logout()">Logout</button>
  <button onclick="loadDashboard()">Refresh</button>
  <p id="loginStatus"></p>
</div>

<div class="row">
  <div class="card">
    <h3>Health</h3>
    Status: <span id="health-status">-</span><br/>
    Dead Letters: <span id="deadLetters">-</span><br/>
    Worker Failures: <span id="workerFailures">-</span>
  </div>

  <div class="card">
    <h3>Delivery Totals</h3>
    Sent: <span id="sentCount">-</span><br/>
    Failed: <span id="failedCount">-</span><br/>
    Queued: <span id="queuedCount">-</span>
  </div>
</div>

<div class="card">
  <h3>Recent Issues</h3>
  <ul id="recentIssues"></ul>
</div>

<div class="card">
  <h3>Metrics</h3>
  <div id="metrics"></div>
</div>

<script>
async function fetchJSON(url) {
  const res = await fetch(url, { credentials: "include" });

  if (!res.ok) {
    throw new Error("HTTP " + res.status);
  }

  return res.json();
}

function setStatus(el, value, thresholds = {}) {
  let color = "lime";

  if (thresholds.fail && value > thresholds.fail) color = "red";
  else if (thresholds.warn && value > thresholds.warn) color = "orange";

  el.style.color = color;
  el.textContent = value;
}

async function login() {
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  const res = await fetch("/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, password })
  });

  if (res.ok) {
    document.getElementById("loginStatus").innerText = "Logged in";
    loadDashboard(); // 🔥 IMPORTANT
  } else {
    document.getElementById("loginStatus").innerText = "Login failed";
  }
}

async function logout() {
  await fetch("/admin/logout", {
    method: "POST",
    credentials: "include"
  });

  document.getElementById("loginStatus").innerText = "Logged out";
}

async function loadDashboard() {
  try {
    document.getElementById("loginStatus").innerText = "Loading...";

    const [health, overview, metrics] = await Promise.all([
      fetchJSON("/admin/ops/health"),
      fetchJSON("/admin/ops/overview"),
      fetchJSON("/admin/delivery-metrics?limit=5")
    ]);

    // HEALTH
    document.getElementById("health-status").textContent =
      health.health.status;

    setStatus(
      document.getElementById("deadLetters"),
      health.health.deadLetterCount,
      { fail: 1 }
    );

    setStatus(
      document.getElementById("workerFailures"),
      health.health.failedWorkerRunsLast24h,
      { fail: 1 }
    );

    // TOTALS
    const totals = overview.overview.deliveryTotals;

    document.getElementById("sentCount").textContent = totals.sent_count;
    document.getElementById("failedCount").textContent = totals.failed_count;
    document.getElementById("queuedCount").textContent = totals.queued_count;

    // ISSUES
    const issuesEl = document.getElementById("recentIssues");
    issuesEl.innerHTML = "";

    overview.overview.recentIssues.forEach(i => {
      const li = document.createElement("li");
      li.textContent = i.title + " (" + i.status + ")";
      issuesEl.appendChild(li);
    });

    // METRICS
    const metricsEl = document.getElementById("metrics");
    metricsEl.innerHTML = "";

    metrics.metrics.forEach(m => {
      const row = document.createElement("div");
      row.textContent =
        m.title + " → Sent: " + m.sent_count + ", Failed: " + m.failed_count;
      metricsEl.appendChild(row);
    });

    document.getElementById("loginStatus").innerText = "Live data loaded";

  } catch (err) {
    console.error(err);
    document.getElementById("loginStatus").innerText =
      "Failed to load data (check console)";
  }
}

// 🔥 AUTO LOAD ON PAGE OPEN (IF SESSION EXISTS)
window.onload = loadDashboard;

// 🔥 AUTO REFRESH
setInterval(loadDashboard, 10000);

</script>

</body>
</html>
  `);
});

export default router;