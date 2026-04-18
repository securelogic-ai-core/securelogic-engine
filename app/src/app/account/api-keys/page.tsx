import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { getApiKeys, getApiUsage } from "@/lib/api";
import { ApiKeysList } from "./ApiKeysList";
import { UsageChart } from "./UsageChart";

export default async function ApiKeysPage() {
  const session = await getSession();
  const token   = session.jwtToken ?? null;
  if (!token) redirect("/login");

  const [keysData, usageData] = await Promise.all([
    getApiKeys(token),
    getApiUsage(token, 30),
  ]);

  const keys   = keysData?.keys ?? [];
  const usage  = usageData ?? { keys: [], daily: [], totalRequests: 0, periodDays: 30 };
  const last7d = usage.keys.reduce((s, k) => s + k.requests_last_7_days, 0);

  return (
    <div style={{ maxWidth: "896px", margin: "0 auto", padding: "48px 24px" }}>
      {/* Header */}
      <div style={{ marginBottom: "32px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div>
            <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#1e293b", margin: "0 0 6px" }}>
              API Keys
            </h1>
            <p style={{ color: "#64748b", margin: 0, fontSize: "14px" }}>
              Programmatic access to your SecureLogic AI data.
            </p>
          </div>
        </div>
      </div>

      {/* Usage summary */}
      {usage.totalRequests > 0 ? (
        <div
          style={{
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: "12px",
            padding: "24px",
            marginBottom: "8px",
          }}
        >
          <h2 style={{ fontSize: "13px", fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 16px" }}>
            Usage (last 30 days)
          </h2>

          {/* Stat tiles */}
          <div style={{ display: "flex", gap: "16px", marginBottom: "20px" }}>
            <StatTile label="Total Requests" value={usage.totalRequests.toLocaleString()} />
            <StatTile label="Last 7 Days" value={last7d.toLocaleString()} />
          </div>

          {/* Bar chart */}
          <UsageChart daily={usage.daily} days={14} />
        </div>
      ) : (
        <div
          style={{
            background: "#f8fafc",
            border: "1px solid #e2e8f0",
            borderRadius: "12px",
            padding: "20px 24px",
            marginBottom: "8px",
          }}
        >
          <p style={{ margin: 0, fontSize: "13px", color: "#94a3b8" }}>
            No API calls recorded yet. Start using your API key to see usage here.
          </p>
        </div>
      )}

      {/* Docs link */}
      <div style={{ textAlign: "right", marginBottom: "24px" }}>
        <Link
          href="/account/api-keys/docs"
          style={{ fontSize: "13px", color: "#00c4b4", textDecoration: "none" }}
        >
          View API Documentation →
        </Link>
      </div>

      {/* Keys list */}
      <ApiKeysList initialKeys={keys} usage={usage.keys} />
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        flex: 1,
        background: "#f8fafc",
        borderRadius: "8px",
        padding: "14px 16px",
      }}
    >
      <p style={{ margin: "0 0 4px", fontSize: "11px", fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </p>
      <p style={{ margin: 0, fontSize: "22px", fontWeight: 700, color: "#1e293b" }}>
        {value}
      </p>
    </div>
  );
}
