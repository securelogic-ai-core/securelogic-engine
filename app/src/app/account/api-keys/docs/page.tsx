import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";

// Engine base URL shown in the API docs examples. Set per environment via
// ENGINE_API_URL; the dev fallback is localhost — never a production host — so a
// staging deploy that is missing the value does not render production URLs in
// staging docs. Matches the convention in app/src/lib/api.ts and the API routes.
const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

function CodeBlock({ children }: { children: string }) {
  return (
    <pre
      style={{
        background: "rgba(0,196,180,0.08)",
        border: "1px solid rgba(0,196,180,0.2)",
        borderRadius: "8px",
        padding: "14px 16px",
        fontFamily: "monospace",
        fontSize: "13px",
        color: "#00c4b4",
        overflowX: "auto",
        margin: "8px 0 20px",
        whiteSpace: "pre-wrap",
        wordBreak: "break-all",
      }}
    >
      {children}
    </pre>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: "36px" }}>
      <h2 style={{ fontSize: "16px", fontWeight: 700, color: "#1e293b", margin: "0 0 12px" }}>
        {title}
      </h2>
      {children}
    </div>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: "14px", color: "#475569", lineHeight: "1.6", margin: "0 0 12px" }}>
      {children}
    </p>
  );
}

export default async function ApiDocsPage() {
  const session = await getSession();
  if (!session.jwtToken && !session.apiKey) redirect("/login");

  const baseUrl = ENGINE_URL;

  return (
    <div style={{ maxWidth: "720px", margin: "0 auto", padding: "48px 24px" }}>
      {/* Back nav */}
      <div style={{ marginBottom: "28px" }}>
        <Link
          href="/account/api-keys"
          style={{ fontSize: "13px", color: "#64748b", textDecoration: "none" }}
        >
          ← Back to API Keys
        </Link>
      </div>

      {/* Page title */}
      <div style={{ marginBottom: "36px" }}>
        <h1 style={{ fontSize: "22px", fontWeight: 700, color: "#1e293b", margin: "0 0 6px" }}>
          API Documentation
        </h1>
        <p style={{ color: "#64748b", margin: 0, fontSize: "14px" }}>
          Programmatic access to your SecureLogic AI platform data.
        </p>
      </div>

      <Section title="Authentication">
        <P>
          Include your API key in the <code style={{ fontFamily: "monospace", fontSize: "13px" }}>Authorization</code> header on every request:
        </P>
        <CodeBlock>{`Authorization: Bearer sl_your_key_here`}</CodeBlock>
        <P>
          API keys are available on all plan tiers. Manage your keys at{" "}
          <Link href="/account/api-keys" style={{ color: "#00c4b4" }}>
            Account → API Keys
          </Link>
          .
        </P>
      </Section>

      <Section title="Base URL">
        <CodeBlock>{baseUrl}</CodeBlock>
        <P>All paths below are relative to this base URL.</P>
      </Section>

      <Section title="Example Requests">
        <h3 style={{ fontSize: "14px", fontWeight: 600, color: "#334155", margin: "0 0 6px" }}>
          1. List all vendors
        </h3>
        <CodeBlock>{`GET /api/vendors\n\ncurl -H "Authorization: Bearer sl_your_key" \\\n  ${baseUrl}/api/vendors`}</CodeBlock>

        <h3 style={{ fontSize: "14px", fontWeight: 600, color: "#334155", margin: "0 0 6px" }}>
          2. Get dashboard summary
        </h3>
        <CodeBlock>{`GET /api/dashboard/summary\n\ncurl -H "Authorization: Bearer sl_your_key" \\\n  ${baseUrl}/api/dashboard/summary`}</CodeBlock>

        <h3 style={{ fontSize: "14px", fontWeight: 600, color: "#334155", margin: "0 0 6px" }}>
          3. Create a finding
        </h3>
        <CodeBlock>{`POST /api/findings\nContent-Type: application/json\n\ncurl -X POST \\\n  -H "Authorization: Bearer sl_your_key" \\\n  -H "Content-Type: application/json" \\\n  -d '{"title":"Missing MFA","severity":"High","status":"open"}' \\\n  ${baseUrl}/api/findings`}</CodeBlock>
      </Section>

      <Section title="Rate Limits">
        <P>
          Paid plans (Brief Pro, Platform): <strong>120 requests per minute</strong>.
        </P>
        <P>
          Starter plan: <strong>20 requests per minute</strong>.
        </P>
        <P>
          When you exceed the limit, the API returns <code style={{ fontFamily: "monospace" }}>429 Too Many Requests</code> with a{" "}
          <code style={{ fontFamily: "monospace" }}>Retry-After</code> header indicating how many seconds to wait.
        </P>
      </Section>

      <Section title="Response Format">
        <P>All responses are JSON. Successful responses return the requested data directly.</P>
        <P>
          Errors return an object with an <code style={{ fontFamily: "monospace" }}>error</code> field:
        </P>
        <CodeBlock>{`{ "error": "not_found" }`}</CodeBlock>
        <P>
          Paginated responses include a <code style={{ fontFamily: "monospace" }}>nextCursor</code> field. Pass it as a query param to fetch the next page:
        </P>
        <CodeBlock>{`GET /api/vendors?before_created_at=2026-04-01T00:00:00Z&before_id=abc-123`}</CodeBlock>
      </Section>

      <Section title="Common HTTP Status Codes">
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
          <tbody>
            {[
              ["200", "Success"],
              ["201", "Created"],
              ["400", "Bad request — check your input"],
              ["401", "Missing or invalid API key"],
              ["403", "Insufficient plan or permissions"],
              ["404", "Resource not found"],
              ["409", "Conflict (e.g. duplicate entry)"],
              ["429", "Rate limit exceeded"],
              ["500", "Internal server error"],
            ].map(([code, desc]) => (
              <tr key={code} style={{ borderBottom: "1px solid #f1f5f9" }}>
                <td style={{ padding: "8px 12px 8px 0", fontFamily: "monospace", color: "#00c4b4", width: "60px" }}>
                  {code}
                </td>
                <td style={{ padding: "8px 0", color: "#475569" }}>{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  );
}
