/**
 * criticalBatchEmail.ts — renderer for the coalesced critical-findings email.
 *
 * One email per org per cycle listing N new Critical/High findings, instead of
 * N separate emails. Mirrors the per-finding alert styling
 * (alertEmailService.sendCriticalFindingAlert) but batches the items.
 */
import { getAppBaseUrl, htmlEscape } from "./alertPrimitives.js";

export type BatchEmailItem = {
  findingId: string;
  title: string;
  severity: "Critical" | "High";
  domain: string | null;
};

export type RenderedEmail = { subject: string; html: string };

const SEVERITY_COLOR: Record<BatchEmailItem["severity"], string> = {
  Critical: "#ef4444",
  High: "#f97316",
};

/**
 * Render a batched critical/high findings email for one org.
 * @param organizationName  the recipient org's display name
 * @param items             ≥1 Critical/High findings new this cycle
 */
export function renderCriticalBatchEmail(
  organizationName: string,
  items: BatchEmailItem[]
): RenderedEmail {
  const findingsUrl = `${getAppBaseUrl()}/findings`;
  const prefsUrl = `${getAppBaseUrl()}/account/alerts`;

  const criticalCount = items.filter((i) => i.severity === "Critical").length;
  const highCount = items.length - criticalCount;

  const countLabel =
    criticalCount > 0 && highCount > 0
      ? `${criticalCount} Critical, ${highCount} High`
      : criticalCount > 0
        ? `${criticalCount} Critical`
        : `${highCount} High`;

  const subject = `[Security] ${items.length} new ${
    items.length === 1 ? "finding" : "findings"
  } affecting ${organizationName} (${countLabel})`;

  const rows = items
    .map((item) => {
      const color = SEVERITY_COLOR[item.severity];
      const domainLabel = item.domain ? ` · ${htmlEscape(item.domain)}` : "";
      return `
        <div style="background:#0f172a;border-radius:8px;padding:16px;margin-bottom:12px;border-left:3px solid ${color};">
          <p style="margin:0 0 4px;font-size:11px;font-weight:600;letter-spacing:0.06em;color:${color};text-transform:uppercase;">${htmlEscape(item.severity)}</p>
          <p style="margin:0;font-size:14px;font-weight:600;color:#f1f5f9;">${htmlEscape(item.title)}</p>
          <p style="margin:4px 0 0;font-size:11px;color:#64748b;">${htmlEscape(organizationName)}${domainLabel}</p>
        </div>`;
    })
    .join("");

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>New findings</title></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#1e293b;border-radius:12px;overflow:hidden;">
        <tr><td style="padding:32px 36px;">
          <p style="margin:0 0 4px;font-size:11px;font-weight:600;letter-spacing:0.08em;color:#64748b;text-transform:uppercase;">SecureLogic AI · Alert</p>
          <h1 style="margin:0 0 24px;font-size:20px;font-weight:700;color:#f1f5f9;">${items.length} new ${items.length === 1 ? "finding" : "findings"} need attention</h1>
          ${rows}
          <a href="${findingsUrl}" style="display:inline-block;background:#00c4b4;color:#0f172a;font-size:13px;font-weight:600;padding:10px 20px;border-radius:8px;text-decoration:none;margin-top:12px;">View all findings →</a>
          <p style="margin:24px 0 0;font-size:11px;color:#334155;">You received this because Critical/High alerts are enabled in your <a href="${prefsUrl}" style="color:#00c4b4;text-decoration:none;">alert preferences</a>.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, html };
}
