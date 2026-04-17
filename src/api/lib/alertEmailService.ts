import { Resend } from "resend";
import { pg } from "../infra/postgres.js";
import { logger } from "../infra/logger.js";

const resend = new Resend(process.env.RESEND_API_KEY ?? "");

function getFromAddress(): string {
  return process.env.NEWSLETTER_FROM_EMAIL?.trim() ?? "SecureLogic AI <noreply@securelogicai.com>";
}

function getAppBaseUrl(): string {
  return (process.env.APP_BASE_URL ?? "https://app.securelogicai.com").replace(/\/$/, "");
}

function htmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function isSuppressed(email: string): Promise<boolean> {
  const r = await pg.query<{ id: string }>(
    `SELECT id FROM email_suppressions WHERE LOWER(email) = LOWER($1) LIMIT 1`,
    [email]
  );
  return r.rows.length > 0;
}

async function isDuplicate(userId: string, alertType: string, referenceId: string): Promise<boolean> {
  const r = await pg.query<{ id: string }>(
    `SELECT id FROM alert_sends WHERE user_id = $1 AND alert_type = $2 AND reference_id = $3 LIMIT 1`,
    [userId, alertType, referenceId]
  );
  return r.rows.length > 0;
}

async function recordSend(userId: string, alertType: string, referenceId: string): Promise<void> {
  await pg.query(
    `INSERT INTO alert_sends (user_id, alert_type, reference_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
    [userId, alertType, referenceId]
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tier 1: Immediate Critical/High finding alert
// ─────────────────────────────────────────────────────────────────────────────

export type CriticalFindingAlertPayload = {
  userId: string;
  email: string;
  findingId: string;
  findingTitle: string;
  severity: string;
  domain: string | null;
  organizationName: string;
};

export async function sendCriticalFindingAlert(payload: CriticalFindingAlertPayload): Promise<void> {
  const { userId, email, findingId, findingTitle, severity, domain, organizationName } = payload;

  const suppressed = await isSuppressed(email);
  if (suppressed) return;

  const dedupeKey = `finding:${findingId}`;
  const duplicate = await isDuplicate(userId, "critical_finding_immediate", dedupeKey);
  if (duplicate) return;

  const findingUrl = `${getAppBaseUrl()}/findings`;
  const domainLabel = domain ? ` · ${htmlEscape(domain)}` : "";
  const severityColor = severity === "Critical" ? "#ef4444" : "#f97316";

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>New ${htmlEscape(severity)} Finding</title></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#1e293b;border-radius:12px;overflow:hidden;">
        <tr>
          <td style="background:${severityColor};padding:4px 0;"></td>
        </tr>
        <tr>
          <td style="padding:32px 36px;">
            <p style="margin:0 0 4px;font-size:11px;font-weight:600;letter-spacing:0.08em;color:#64748b;text-transform:uppercase;">SecureLogic AI · Alert</p>
            <h1 style="margin:0 0 24px;font-size:20px;font-weight:700;color:#f1f5f9;">New ${htmlEscape(severity)} Finding</h1>
            <div style="background:#0f172a;border-radius:8px;padding:20px;margin-bottom:24px;border-left:3px solid ${severityColor};">
              <p style="margin:0 0 8px;font-size:15px;font-weight:600;color:#f1f5f9;">${htmlEscape(findingTitle)}</p>
              <p style="margin:0;font-size:12px;color:#64748b;">${htmlEscape(organizationName)}${domainLabel}</p>
            </div>
            <a href="${findingUrl}" style="display:inline-block;background:#00c4b4;color:#0f172a;font-size:13px;font-weight:600;padding:10px 20px;border-radius:8px;text-decoration:none;">View Finding →</a>
            <p style="margin:24px 0 0;font-size:11px;color:#334155;">You received this alert because ${htmlEscape(severity)} findings are enabled in your <a href="${getAppBaseUrl()}/account/alerts" style="color:#00c4b4;text-decoration:none;">alert preferences</a>.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  try {
    await resend.emails.send({
      from: getFromAddress(),
      to: email,
      subject: `[${severity}] New finding: ${findingTitle}`,
      html,
    });
    await recordSend(userId, "critical_finding_immediate", dedupeKey);
    logger.info({ event: "alert_sent", alertType: "critical_finding_immediate", userId, findingId }, "Critical finding alert sent");
  } catch (err) {
    logger.warn({ event: "alert_send_failed", alertType: "critical_finding_immediate", userId, err }, "Critical finding alert failed");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tier 2: Daily digest
// ─────────────────────────────────────────────────────────────────────────────

export type DailyDigestPayload = {
  userId: string;
  email: string;
  organizationName: string;
  newFindings: Array<{ id: string; title: string; severity: string; domain: string | null }>;
  openCount: number;
  criticalCount: number;
};

export async function sendDailyDigest(payload: DailyDigestPayload): Promise<void> {
  const { userId, email, organizationName, newFindings, openCount, criticalCount } = payload;

  const suppressed = await isSuppressed(email);
  if (suppressed) return;

  const today = new Date().toISOString().slice(0, 10);
  const dedupeKey = `digest:${today}`;
  const duplicate = await isDuplicate(userId, "daily_digest", dedupeKey);
  if (duplicate) return;

  const findingsUrl = `${getAppBaseUrl()}/findings`;

  const findingRows = newFindings.slice(0, 10).map((f) => {
    const sevColor = f.severity === "Critical" ? "#fca5a5" : f.severity === "High" ? "#fdba74" : "#fcd34d";
    const domainStr = f.domain ? ` <span style="color:#475569">· ${htmlEscape(f.domain)}</span>` : "";
    return `<tr>
      <td style="padding:8px 0;border-bottom:1px solid #1e293b;">
        <span style="display:inline-block;background:rgba(255,255,255,0.06);color:${sevColor};font-size:10px;font-weight:700;padding:1px 6px;border-radius:4px;margin-right:8px;">${htmlEscape(f.severity)}</span>
        <span style="font-size:13px;color:#cbd5e1;">${htmlEscape(f.title)}${domainStr}</span>
      </td>
    </tr>`;
  }).join("");

  const moreNote = newFindings.length > 10
    ? `<p style="margin:12px 0 0;font-size:12px;color:#475569;">+ ${newFindings.length - 10} more new findings</p>`
    : "";

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Daily Findings Digest</title></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#1e293b;border-radius:12px;overflow:hidden;">
        <tr><td style="padding:32px 36px;">
          <p style="margin:0 0 4px;font-size:11px;font-weight:600;letter-spacing:0.08em;color:#64748b;text-transform:uppercase;">SecureLogic AI · Daily Digest</p>
          <h1 style="margin:0 0 6px;font-size:20px;font-weight:700;color:#f1f5f9;">${htmlEscape(organizationName)}</h1>
          <p style="margin:0 0 24px;font-size:13px;color:#475569;">${today}</p>
          <div style="display:flex;gap:16px;margin-bottom:24px;">
            <div style="flex:1;background:#0f172a;border-radius:8px;padding:16px;text-align:center;">
              <p style="margin:0 0 4px;font-size:24px;font-weight:700;color:#fca5a5;">${openCount}</p>
              <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;">Open</p>
            </div>
            <div style="flex:1;background:#0f172a;border-radius:8px;padding:16px;text-align:center;">
              <p style="margin:0 0 4px;font-size:24px;font-weight:700;color:#fca5a5;">${criticalCount}</p>
              <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;">Critical</p>
            </div>
            <div style="flex:1;background:#0f172a;border-radius:8px;padding:16px;text-align:center;">
              <p style="margin:0 0 4px;font-size:24px;font-weight:700;color:#93c5fd;">${newFindings.length}</p>
              <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;">New (24h)</p>
            </div>
          </div>
          ${newFindings.length > 0 ? `
          <h2 style="margin:0 0 12px;font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;">New Findings</h2>
          <table width="100%" cellpadding="0" cellspacing="0">${findingRows}</table>
          ${moreNote}` : `<p style="color:#475569;font-size:13px;">No new findings in the last 24 hours.</p>`}
          <div style="margin-top:24px;">
            <a href="${findingsUrl}" style="display:inline-block;background:#00c4b4;color:#0f172a;font-size:13px;font-weight:600;padding:10px 20px;border-radius:8px;text-decoration:none;">View All Findings →</a>
          </div>
          <p style="margin:24px 0 0;font-size:11px;color:#334155;">Manage your preferences at <a href="${getAppBaseUrl()}/account/alerts" style="color:#00c4b4;text-decoration:none;">Alert Settings</a>.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  try {
    await resend.emails.send({
      from: getFromAddress(),
      to: email,
      subject: `SecureLogic AI — Daily Digest (${newFindings.length} new finding${newFindings.length !== 1 ? "s" : ""})`,
      html,
    });
    await recordSend(userId, "daily_digest", dedupeKey);
    logger.info({ event: "alert_sent", alertType: "daily_digest", userId }, "Daily digest sent");
  } catch (err) {
    logger.warn({ event: "alert_send_failed", alertType: "daily_digest", userId, err }, "Daily digest failed");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tier 3: Weekly posture summary
// ─────────────────────────────────────────────────────────────────────────────

export type WeeklySummaryPayload = {
  userId: string;
  email: string;
  organizationName: string;
  postureScore: number | null;
  openFindings: number;
  criticalFindings: number;
  frameworkReadiness: Array<{ name: string; score: number }>;
};

export async function sendWeeklySummary(payload: WeeklySummaryPayload): Promise<void> {
  const { userId, email, organizationName, postureScore, openFindings, criticalFindings, frameworkReadiness } = payload;

  const suppressed = await isSuppressed(email);
  if (suppressed) return;

  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const weekKey = weekStart.toISOString().slice(0, 10);
  const dedupeKey = `weekly:${weekKey}`;
  const duplicate = await isDuplicate(userId, "weekly_summary", dedupeKey);
  if (duplicate) return;

  const dashboardUrl = `${getAppBaseUrl()}/dashboard`;
  const scoreColor = postureScore == null ? "#64748b"
    : postureScore >= 75 ? "#22c55e"
    : postureScore >= 50 ? "#f59e0b"
    : postureScore >= 25 ? "#f97316"
    : "#ef4444";

  const frameworkRows = frameworkReadiness.slice(0, 5).map((f) => {
    const fc = f.score >= 75 ? "#86efac" : f.score >= 50 ? "#fcd34d" : "#fca5a5";
    return `<tr>
      <td style="padding:8px 0;border-bottom:1px solid #1e293b;font-size:13px;color:#cbd5e1;">${htmlEscape(f.name)}</td>
      <td style="padding:8px 0;border-bottom:1px solid #1e293b;text-align:right;font-size:13px;font-weight:700;color:${fc};">${f.score}%</td>
    </tr>`;
  }).join("");

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Weekly Posture Summary</title></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#1e293b;border-radius:12px;overflow:hidden;">
        <tr><td style="padding:32px 36px;">
          <p style="margin:0 0 4px;font-size:11px;font-weight:600;letter-spacing:0.08em;color:#64748b;text-transform:uppercase;">SecureLogic AI · Weekly Summary</p>
          <h1 style="margin:0 0 6px;font-size:20px;font-weight:700;color:#f1f5f9;">${htmlEscape(organizationName)}</h1>
          <p style="margin:0 0 24px;font-size:13px;color:#475569;">Week of ${weekKey}</p>
          <div style="background:#0f172a;border-radius:8px;padding:20px;margin-bottom:24px;text-align:center;">
            <p style="margin:0 0 4px;font-size:11px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;">Overall Posture Score</p>
            <p style="margin:0;font-size:48px;font-weight:800;color:${scoreColor};">${postureScore != null ? `${postureScore}%` : "—"}</p>
          </div>
          <div style="display:flex;gap:12px;margin-bottom:24px;">
            <div style="flex:1;background:#0f172a;border-radius:8px;padding:16px;text-align:center;">
              <p style="margin:0 0 4px;font-size:22px;font-weight:700;color:#fca5a5;">${openFindings}</p>
              <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;">Open Findings</p>
            </div>
            <div style="flex:1;background:#0f172a;border-radius:8px;padding:16px;text-align:center;">
              <p style="margin:0 0 4px;font-size:22px;font-weight:700;color:#fca5a5;">${criticalFindings}</p>
              <p style="margin:0;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;">Critical</p>
            </div>
          </div>
          ${frameworkReadiness.length > 0 ? `
          <h2 style="margin:0 0 12px;font-size:12px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.06em;">Framework Readiness</h2>
          <table width="100%" cellpadding="0" cellspacing="0">${frameworkRows}</table>` : ""}
          <div style="margin-top:24px;">
            <a href="${dashboardUrl}" style="display:inline-block;background:#00c4b4;color:#0f172a;font-size:13px;font-weight:600;padding:10px 20px;border-radius:8px;text-decoration:none;">View Dashboard →</a>
          </div>
          <p style="margin:24px 0 0;font-size:11px;color:#334155;">Manage your preferences at <a href="${getAppBaseUrl()}/account/alerts" style="color:#00c4b4;text-decoration:none;">Alert Settings</a>.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  try {
    await resend.emails.send({
      from: getFromAddress(),
      to: email,
      subject: `SecureLogic AI — Weekly Posture Summary`,
      html,
    });
    await recordSend(userId, "weekly_summary", dedupeKey);
    logger.info({ event: "alert_sent", alertType: "weekly_summary", userId }, "Weekly summary sent");
  } catch (err) {
    logger.warn({ event: "alert_send_failed", alertType: "weekly_summary", userId, err }, "Weekly summary failed");
  }
}
