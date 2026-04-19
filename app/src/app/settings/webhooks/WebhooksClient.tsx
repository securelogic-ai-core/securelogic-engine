"use client";

import { useState, useTransition } from "react";
import type { WebhookEndpoint, WebhookEndpointWithSecret, WebhookDelivery } from "@/lib/api";
import {
  createWebhookAction,
  deleteWebhookAction,
  testWebhookAction,
  getDeliveriesAction,
} from "./actions";

const CARD: React.CSSProperties = {
  background: "#0d1626",
  border: "1px solid #1e2d45",
  borderRadius: "12px",
};

const INPUT: React.CSSProperties = {
  width: "100%",
  background: "#0a0f1a",
  border: "1px solid #1e2d45",
  borderRadius: "8px",
  color: "#f1f5f9",
  padding: "8px 12px",
  fontSize: "13px",
  outline: "none",
};

const ALL_EVENT_TYPES = [
  { value: "finding.created",          label: "finding.created" },
  { value: "finding.updated",          label: "finding.updated" },
  { value: "risk.created",             label: "risk.created" },
  { value: "vendor.assessed",          label: "vendor.assessed" },
  { value: "posture.snapshot_created", label: "posture.snapshot_created" },
  { value: "action.created",           label: "action.created" },
  { value: "action.updated",           label: "action.updated" },
];

function statusColor(status: string): string {
  if (status === "active") return "#86efac";
  if (status === "failed") return "#fca5a5";
  return "#94a3b8";
}

function statusBg(status: string): string {
  if (status === "active") return "rgba(34,197,94,0.12)";
  if (status === "failed") return "rgba(239,68,68,0.12)";
  return "rgba(148,163,184,0.10)";
}

function deliveryStatusColor(s: string): string {
  if (s === "delivered") return "#86efac";
  if (s === "failed") return "#fca5a5";
  if (s === "retrying") return "#fcd34d";
  return "#94a3b8";
}

function fmt(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function SecretReveal({ secret, onDone }: { secret: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ ...CARD, padding: "20px", marginBottom: "20px", borderColor: "rgba(0,196,180,0.3)", background: "rgba(0,196,180,0.06)" }}>
      <p style={{ margin: "0 0 6px", fontSize: "13px", fontWeight: 700, color: "#00c4b4" }}>
        ⚠ Save this secret now. It will not be shown again.
      </p>
      <code style={{ display: "block", fontFamily: "monospace", fontSize: "12px", wordBreak: "break-all", color: "#00c4b4", marginBottom: "12px", lineHeight: 1.6 }}>
        {secret}
      </code>
      <div style={{ display: "flex", gap: "8px" }}>
        <button
          onClick={() => { navigator.clipboard.writeText(secret).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }}
          style={{ padding: "6px 14px", background: "transparent", border: "1px solid rgba(0,196,180,0.4)", borderRadius: "6px", color: "#00c4b4", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
        <button
          onClick={onDone}
          style={{ padding: "6px 14px", background: "#00c4b4", border: "none", borderRadius: "6px", color: "#0a0f1a", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}
        >
          Done
        </button>
      </div>
    </div>
  );
}

function AddForm({ onSuccess }: { onSuccess: (ep: WebhookEndpointWithSecret) => void }) {
  const [url, setUrl]             = useState("");
  const [description, setDesc]    = useState("");
  const [allEvents, setAllEvents] = useState(true);
  const [selected, setSelected]   = useState<string[]>([]);
  const [error, setError]         = useState<string | null>(null);
  const [isPending, start]        = useTransition();

  function toggle(v: string) {
    setSelected((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.startsWith("https://")) { setError("URL must start with https://"); return; }
    setError(null);
    const event_types = allEvents ? ["*"] : selected.length ? selected : ["*"];
    start(async () => {
      const result = await createWebhookAction({ url, description: description.trim() || undefined, event_types });
      if ("error" in result) { setError(result.error); return; }
      onSuccess(result.endpoint);
      setUrl(""); setDesc(""); setAllEvents(true); setSelected([]);
    });
  }

  return (
    <form onSubmit={handleSubmit} style={{ ...CARD, padding: "20px", marginBottom: "24px" }}>
      <h3 style={{ margin: "0 0 16px", fontSize: "14px", fontWeight: 600, color: "#f1f5f9" }}>Add Endpoint</h3>
      {error && <p style={{ margin: "0 0 12px", fontSize: "13px", color: "#fca5a5" }}>{error}</p>}
      <div style={{ marginBottom: "12px" }}>
        <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "6px" }}>
          URL <span style={{ color: "#fca5a5" }}>*</span>
        </label>
        <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-server.com/webhooks" style={INPUT} required />
      </div>
      <div style={{ marginBottom: "12px" }}>
        <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "6px" }}>
          Description (optional)
        </label>
        <input type="text" value={description} onChange={(e) => setDesc(e.target.value)} placeholder="e.g. Production alerts" style={INPUT} />
      </div>
      <div style={{ marginBottom: "16px" }}>
        <label style={{ display: "block", fontSize: "11px", fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "8px" }}>
          Events
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#f1f5f9", marginBottom: "6px", cursor: "pointer" }}>
          <input type="checkbox" checked={allEvents} onChange={(e) => setAllEvents(e.target.checked)} />
          All events (*)
        </label>
        {!allEvents && ALL_EVENT_TYPES.map(({ value, label }) => (
          <label key={value} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#94a3b8", marginBottom: "4px", cursor: "pointer", paddingLeft: "20px" }}>
            <input type="checkbox" checked={selected.includes(value)} onChange={() => toggle(value)} />
            {label}
          </label>
        ))}
      </div>
      <button
        type="submit"
        disabled={isPending}
        style={{ padding: "8px 20px", background: "#00c4b4", border: "none", borderRadius: "8px", color: "#0a0f1a", fontSize: "13px", fontWeight: 600, cursor: isPending ? "not-allowed" : "pointer", opacity: isPending ? 0.6 : 1 }}
      >
        {isPending ? "Saving…" : "Save Endpoint"}
      </button>
    </form>
  );
}

function DeliveryLog({ endpointId }: { endpointId: string }) {
  const [open, setOpen]             = useState(false);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [loading, setLoading]       = useState(false);

  async function load() {
    if (open) { setOpen(false); return; }
    setLoading(true);
    const result = await getDeliveriesAction(endpointId);
    setDeliveries(result ?? []);
    setLoading(false);
    setOpen(true);
  }

  return (
    <div style={{ marginTop: "10px" }}>
      <button onClick={load} style={{ fontSize: "12px", color: "#94a3b8", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
        {loading ? "Loading…" : open ? "▾ Hide deliveries" : "▸ Recent deliveries"}
      </button>
      {open && (
        <div style={{ marginTop: "8px" }}>
          {deliveries.length === 0
            ? <p style={{ fontSize: "12px", color: "#475569" }}>No deliveries yet.</p>
            : deliveries.slice(0, 10).map((d) => (
              <div key={d.id} style={{ display: "flex", gap: "12px", alignItems: "center", padding: "6px 0", borderBottom: "1px solid #1e2d45", fontSize: "12px" }}>
                <span style={{ color: deliveryStatusColor(d.status), fontWeight: 600, minWidth: "70px" }}>{d.status}</span>
                <span style={{ color: "#64748b" }}>{d.event_type}</span>
                <span style={{ color: "#475569", marginLeft: "auto" }}>{fmt(d.created_at)}</span>
                {d.response_status && <span style={{ color: d.response_status < 300 ? "#86efac" : "#fca5a5" }}>{d.response_status}</span>}
              </div>
            ))
          }
        </div>
      )}
    </div>
  );
}

function EndpointCard({
  endpoint,
  onDelete,
  isAdmin,
}: {
  endpoint: WebhookEndpoint;
  onDelete: (id: string) => void;
  isAdmin: boolean;
}) {
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, startTest]        = useTransition();
  const [deleting, startDelete]     = useTransition();

  function handleTest() {
    startTest(async () => {
      const result = await testWebhookAction(endpoint.id);
      setTestResult(result?.status ?? "error");
    });
  }

  function handleDelete() {
    if (!confirm("Delete this webhook endpoint? This cannot be undone.")) return;
    startDelete(async () => {
      const ok = await deleteWebhookAction(endpoint.id);
      if (ok) onDelete(endpoint.id);
    });
  }

  const eventLabel =
    endpoint.event_types.includes("*")
      ? "All events"
      : endpoint.event_types.join(", ");

  return (
    <div style={{ ...CARD, padding: "16px 20px", marginBottom: "12px" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
            <span style={{ fontSize: "13px", fontWeight: 600, color: "#f1f5f9", wordBreak: "break-all" }}>
              {endpoint.url}
            </span>
            <span style={{ fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: "20px", background: statusBg(endpoint.status), color: statusColor(endpoint.status), flexShrink: 0 }}>
              {endpoint.status}
            </span>
          </div>
          {endpoint.description && (
            <p style={{ margin: "0 0 4px", fontSize: "12px", color: "#64748b" }}>{endpoint.description}</p>
          )}
          <p style={{ margin: "0 0 4px", fontSize: "12px", color: "#475569" }}>
            Events: <span style={{ color: "#94a3b8" }}>{eventLabel}</span>
          </p>
          <p style={{ margin: 0, fontSize: "12px", color: "#475569", fontFamily: "monospace" }}>
            {endpoint.secret_hint}
          </p>
          {endpoint.last_success_at && (
            <p style={{ margin: "4px 0 0", fontSize: "11px", color: "#475569" }}>
              Last delivery: {fmt(endpoint.last_success_at)}
            </p>
          )}
        </div>
        <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
          <button
            onClick={handleTest}
            disabled={testing}
            style={{ padding: "5px 12px", fontSize: "12px", fontWeight: 600, borderRadius: "6px", border: "1px solid #1e2d45", background: "transparent", color: testing ? "#475569" : "#94a3b8", cursor: testing ? "not-allowed" : "pointer" }}
          >
            {testing ? "Testing…" : "Test"}
          </button>
          {isAdmin && (
            <button
              onClick={handleDelete}
              disabled={deleting}
              style={{ padding: "5px 12px", fontSize: "12px", fontWeight: 600, borderRadius: "6px", border: "1px solid rgba(239,68,68,0.3)", background: "transparent", color: deleting ? "#475569" : "#fca5a5", cursor: deleting ? "not-allowed" : "pointer" }}
            >
              {deleting ? "…" : "Delete"}
            </button>
          )}
        </div>
      </div>
      {testResult && (
        <p style={{ margin: "8px 0 0", fontSize: "12px", color: testResult === "delivered" ? "#86efac" : "#fcd34d" }}>
          Test result: {testResult}
        </p>
      )}
      <DeliveryLog endpointId={endpoint.id} />
    </div>
  );
}

interface Props {
  initialEndpoints: WebhookEndpoint[];
  isAdmin: boolean;
}

export function WebhooksClient({ initialEndpoints, isAdmin }: Props) {
  const [endpoints, setEndpoints]       = useState<WebhookEndpoint[]>(initialEndpoints);
  const [newSecret, setNewSecret]       = useState<string | null>(null);
  const [showForm, setShowForm]         = useState(false);

  function handleCreated(ep: WebhookEndpointWithSecret) {
    const { secret, ...rest } = ep;
    setEndpoints((prev) => [rest as WebhookEndpoint, ...prev]);
    setNewSecret(secret);
    setShowForm(false);
  }

  function handleDeleted(id: string) {
    setEndpoints((prev) => prev.filter((e) => e.id !== id));
  }

  return (
    <div>
      {newSecret && <SecretReveal secret={newSecret} onDone={() => setNewSecret(null)} />}

      {showForm ? (
        <AddForm onSuccess={handleCreated} />
      ) : (
        <button
          onClick={() => setShowForm(true)}
          style={{ marginBottom: "24px", padding: "8px 18px", background: "#00c4b4", border: "none", borderRadius: "8px", color: "#0a0f1a", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}
        >
          + Add Endpoint
        </button>
      )}

      {endpoints.length === 0 && !showForm ? (
        <div style={{ ...CARD, padding: "40px 24px", textAlign: "center" }}>
          <p style={{ margin: "0 0 8px", fontSize: "14px", fontWeight: 600, color: "#f1f5f9" }}>
            No webhook endpoints configured.
          </p>
          <p style={{ margin: 0, fontSize: "13px", color: "#64748b" }}>
            Add your first endpoint to start receiving real-time events.
          </p>
        </div>
      ) : (
        endpoints.map((ep) => (
          <EndpointCard key={ep.id} endpoint={ep} onDelete={handleDeleted} isAdmin={isAdmin} />
        ))
      )}
    </div>
  );
}
