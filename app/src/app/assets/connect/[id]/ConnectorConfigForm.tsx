"use client";

/**
 * ConnectorConfigForm — admin-only connector configuration (EAR P16). Renders a
 * dynamic credential form from the connector's `config_fields` (returned by
 * GET /api/connectors — the engine is the source of truth for what each adapter
 * needs) and drives the EXISTING mutation endpoints via the app wrappers:
 *   Save     → PUT /api/connectors/:id     (credentials + enable + schedule)
 *   Run sync → POST /api/connectors/:id/sync
 *   Disconnect → DELETE /api/connectors/:id
 * No connector logic lives here — only form state + calls. The engine enforces
 * admin role, tenant scope, the dark flags, and credential encryption.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveConnectorConfig, disconnectConnector, syncConnector } from "@/lib/api";
import type { OrgConnector } from "@/lib/connectors";

const inputClass = "w-full rounded-lg px-3 py-2 text-sm border outline-none transition-colors";
const inputStyle = { background: "#0a0f1a", borderColor: "#1e2d45", color: "#f1f5f9" };
const labelClass = "block text-xs font-semibold uppercase tracking-wide mb-1.5";

/** Human copy for a connector mutation error code — never leak a raw code. */
function connectorErrorMessage(code: string): string {
  switch (code) {
    case "forbidden":
    case "insufficient_permissions":
      return "Only administrators can configure connectors.";
    case "invalid_config":
    case "invalid_body":
      return "Some credentials are missing or invalid. Check the required fields.";
    case "not_configured":
      return "Add and save credentials before running a sync.";
    case "connector_disabled":
      return "Enable syncing before running a sync.";
    case "sync_already_pending":
      return "A sync is already in progress for this connector.";
    case "capability_required":
      return "Your organization doesn't have access to enterprise connectors.";
    case "engine_unavailable":
    case "network_error":
      return "The service is temporarily unavailable. Try again.";
    default:
      return "Something went wrong. Try again.";
  }
}

export default function ConnectorConfigForm({ connector }: { connector: OrgConnector }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [enabled, setEnabled] = useState<boolean>(connector.enabled);
  const [interval, setIntervalValue] = useState<string>(
    connector.sync_interval_minutes != null ? String(connector.sync_interval_minutes) : "",
  );
  const [busy, setBusy] = useState<"save" | "sync" | "disconnect" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const savedKeys = new Set(connector.config_keys ?? []);

  async function handleSave() {
    setBusy("save");
    setError(null);
    setNotice(null);

    // Send only the fields the admin actually entered (non-empty). Saved secrets
    // are not re-echoed by the engine, so leaving a field blank keeps its value
    // only if the adapter treats an absent key as unchanged; required fields must
    // be (re-)entered when first configuring.
    const config: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) {
      if (v.trim().length > 0) config[k] = v.trim();
    }

    const body: { config?: Record<string, string>; enabled: boolean; sync_interval_minutes: number | null } = {
      enabled,
      sync_interval_minutes: interval.trim() === "" ? null : Number(interval),
    };
    if (Object.keys(config).length > 0) body.config = config;

    const result = await saveConnectorConfig(connector.connector_id, body);
    if (!result.ok) {
      setError(connectorErrorMessage(result.error));
    } else {
      setNotice("Saved.");
      setValues({});
      router.refresh();
    }
    setBusy(null);
  }

  async function handleSync() {
    setBusy("sync");
    setError(null);
    setNotice(null);
    const result = await syncConnector(connector.connector_id);
    if (!result.ok) {
      setError(connectorErrorMessage(result.error));
    } else {
      setNotice("Sync requested — discovered assets will appear shortly.");
      router.refresh();
    }
    setBusy(null);
  }

  async function handleDisconnect() {
    if (!window.confirm(`Disconnect ${connector.display_name}? Saved credentials will be removed.`)) return;
    setBusy("disconnect");
    setError(null);
    setNotice(null);
    const result = await disconnectConnector(connector.connector_id);
    if (!result.ok) {
      setError(connectorErrorMessage(result.error));
      setBusy(null);
    } else {
      router.push("/assets/connect");
      router.refresh();
    }
  }

  const fields = connector.config_fields ?? [];

  return (
    <div className="space-y-6">
      <div className="bg-brand-surface border border-brand-line rounded-xl p-6 space-y-5">
        <div className="space-y-4">
          {fields.length === 0 && (
            <p className="text-xs" style={{ color: "#64748b" }}>
              This connector needs no credentials — enable syncing below.
            </p>
          )}
          {fields.map((f) => (
            <div key={f.key}>
              <label className={labelClass} style={{ color: "#94a3b8" }}>
                {f.label}
                {f.required && <span style={{ color: "#fca5a5" }}> *</span>}
                {savedKeys.has(f.key) && (
                  <span className="ml-2 font-normal normal-case" style={{ color: "#64748b" }}>
                    (saved — leave blank to keep)
                  </span>
                )}
              </label>
              <input
                type={f.kind === "secret" ? "password" : "text"}
                autoComplete="off"
                value={values[f.key] ?? ""}
                placeholder={savedKeys.has(f.key) ? "••••••••" : ""}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                className={inputClass}
                style={inputStyle}
                disabled={busy !== null}
              />
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="flex items-center gap-2 text-sm" style={{ color: "#cbd5e1" }}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              disabled={busy !== null}
            />
            Enable syncing
          </label>
          <div>
            <label className={labelClass} style={{ color: "#94a3b8" }}>
              Sync interval (minutes, optional)
            </label>
            <input
              type="number"
              min={1}
              value={interval}
              onChange={(e) => setIntervalValue(e.target.value)}
              placeholder="e.g. 1440"
              className={inputClass}
              style={inputStyle}
              disabled={busy !== null}
            />
          </div>
        </div>

        {error && (
          <p
            className="rounded-lg border px-4 py-3 text-sm"
            style={{ borderColor: "rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.06)", color: "#fca5a5" }}
          >
            {error}
          </p>
        )}
        {notice && (
          <p
            className="rounded-lg border px-4 py-3 text-sm"
            style={{ borderColor: "rgba(0,196,180,0.3)", background: "rgba(0,196,180,0.06)", color: "#86efac" }}
          >
            {notice}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button
            type="button"
            onClick={handleSave}
            disabled={busy !== null}
            className="px-4 py-2 rounded-lg text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ background: "#00c4b4", color: "#0a0f1a" }}
          >
            {busy === "save" ? "Saving…" : "Save configuration"}
          </button>
          {connector.configured && (
            <button
              type="button"
              onClick={handleSync}
              disabled={busy !== null}
              className="px-4 py-2 rounded-lg text-sm font-medium border transition-colors hover:opacity-80 disabled:opacity-50"
              style={{ borderColor: "#1e293b", color: "#cbd5e1" }}
            >
              {busy === "sync" ? "Requesting…" : "Run sync now"}
            </button>
          )}
          {connector.configured && (
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={busy !== null}
              className="px-4 py-2 rounded-lg text-sm font-medium border transition-colors hover:opacity-80 disabled:opacity-50 ml-auto"
              style={{ borderColor: "rgba(239,68,68,0.3)", color: "#fca5a5" }}
            >
              {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
