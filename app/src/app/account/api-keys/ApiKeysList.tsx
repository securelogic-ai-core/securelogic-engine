"use client";

import { useState, useTransition } from "react";
import type { ApiKeyRecord, KeyUsageSummary } from "@/lib/api";
import { createKeyAction, revokeKeyAction } from "./actions";

interface Props {
  initialKeys: ApiKeyRecord[];
  usage: KeyUsageSummary[];
}

function StatusBadge({ status }: { status: string }) {
  const isActive = status === "active";
  return (
    <span
      style={{
        display: "inline-block",
        background: isActive ? "rgba(34,197,94,0.15)" : "rgba(100,116,139,0.1)",
        color: isActive ? "#86efac" : "#64748b",
        fontSize: "11px",
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: "20px",
      }}
    >
      {isActive ? "Active" : "Revoked"}
    </span>
  );
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function RawKeyReveal({ rawKey, onDone }: { rawKey: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(rawKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div
      style={{
        background: "rgba(0,196,180,0.08)",
        border: "1px solid rgba(0,196,180,0.3)",
        borderRadius: "8px",
        padding: "16px",
        marginBottom: "20px",
      }}
    >
      <p style={{ margin: "0 0 8px", fontSize: "13px", fontWeight: 600, color: "#00c4b4" }}>
        Your new API key — copy it now. It will not be shown again.
      </p>
      <code
        style={{
          display: "block",
          fontFamily: "monospace",
          fontSize: "13px",
          wordBreak: "break-all",
          color: "#00c4b4",
          marginBottom: "12px",
          lineHeight: "1.6",
        }}
      >
        {rawKey}
      </code>
      <div style={{ display: "flex", gap: "8px" }}>
        <button
          onClick={handleCopy}
          style={{
            padding: "6px 14px",
            background: "transparent",
            border: "1px solid rgba(0,196,180,0.5)",
            borderRadius: "6px",
            color: "#00c4b4",
            fontSize: "12px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {copied ? "Copied ✓" : "Copy to clipboard"}
        </button>
        <button
          onClick={onDone}
          style={{
            padding: "6px 14px",
            background: "#00c4b4",
            border: "none",
            borderRadius: "6px",
            color: "#fff",
            fontSize: "12px",
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Done
        </button>
      </div>
    </div>
  );
}

function CreateForm({
  onSuccess,
  onCancel,
}: {
  onSuccess: (rawKey: string, key: ApiKeyRecord) => void;
  onCancel: () => void;
}) {
  const [label, setLabel]         = useState("");
  const [error, setError]         = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = label.trim();
    if (!trimmed) { setError("Label is required"); return; }
    if (trimmed.length > 100) { setError("Label must be 100 characters or fewer"); return; }
    setError(null);

    startTransition(async () => {
      const result = await createKeyAction(trimmed);
      if ("error" in result) {
        setError(result.error);
      } else {
        onSuccess(result.rawKey, result.key);
      }
    });
  }

  return (
    <div
      style={{
        background: "#0d1b2e",
        border: "1px solid #1e2d45",
        borderRadius: "12px",
        padding: "20px",
        marginBottom: "20px",
      }}
    >
      <h3 style={{ margin: "0 0 16px", fontSize: "14px", fontWeight: 600, color: "#f1f5f9" }}>
        Create New API Key
      </h3>
      {error && (
        <p style={{ margin: "0 0 12px", fontSize: "13px", color: "#fca5a5" }}>{error}</p>
      )}
      <form onSubmit={handleSubmit} style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={100}
          placeholder="e.g. Production, CI/CD, Zapier integration"
          required
          style={{
            flex: 1,
            background: "#060d18",
            border: "1px solid #1e2d45",
            borderRadius: "8px",
            padding: "10px 14px",
            fontSize: "14px",
            color: "#f1f5f9",
            outline: "none",
          }}
        />
        <button
          type="submit"
          disabled={isPending}
          style={{
            padding: "10px 20px",
            background: isPending ? "#009e91" : "#00c4b4",
            border: "none",
            borderRadius: "8px",
            color: "#fff",
            fontSize: "14px",
            fontWeight: 600,
            cursor: isPending ? "not-allowed" : "pointer",
            opacity: isPending ? 0.7 : 1,
            whiteSpace: "nowrap",
          }}
        >
          {isPending ? "Creating…" : "Create Key"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          style={{
            padding: "10px 16px",
            background: "transparent",
            border: "none",
            color: "#64748b",
            fontSize: "14px",
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
      </form>
    </div>
  );
}

export function ApiKeysList({ initialKeys, usage }: Props) {
  const [keys, setKeys]           = useState<ApiKeyRecord[]>(initialKeys);
  const [showCreate, setShowCreate] = useState(false);
  const [newRawKey, setNewRawKey] = useState<string | null>(null);
  const [revoking, setRevoking]   = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<{ id: string; msg: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const usageByKeyId = new Map(usage.map((u) => [u.key_id, u]));
  const activeCount  = keys.filter((k) => k.status === "active").length;

  function handleCreateSuccess(rawKey: string, newKey: ApiKeyRecord) {
    setKeys((prev) => [{ ...newKey, created_by_name: null }, ...prev]);
    setShowCreate(false);
    setNewRawKey(rawKey);
  }

  function handleRevoke(keyId: string) {
    setRevoking(keyId);
    setRevokeError(null);
  }

  function confirmRevoke(keyId: string) {
    startTransition(async () => {
      const result = await revokeKeyAction(keyId);
      if ("error" in result) {
        setRevokeError({ id: keyId, msg: result.error });
        setRevoking(null);
      } else {
        setKeys((prev) =>
          prev.map((k) =>
            k.id === keyId
              ? { ...k, status: "revoked" as const, revoked_at: new Date().toISOString() }
              : k
          )
        );
        setRevoking(null);
      }
    });
  }

  return (
    <div>
      {/* New key reveal */}
      {newRawKey && (
        <RawKeyReveal rawKey={newRawKey} onDone={() => setNewRawKey(null)} />
      )}

      {/* Create form or button */}
      {showCreate ? (
        <CreateForm
          onSuccess={handleCreateSuccess}
          onCancel={() => setShowCreate(false)}
        />
      ) : (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "16px" }}>
          <button
            onClick={() => setShowCreate(true)}
            style={{
              padding: "9px 18px",
              background: "#00c4b4",
              border: "none",
              borderRadius: "8px",
              color: "#fff",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            + Create Key
          </button>
        </div>
      )}

      {/* Key cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        {keys.map((key) => {
          const usageSummary = usageByKeyId.get(key.id);
          const isLastActive = key.status === "active" && activeCount <= 1;
          const isRevoking   = revoking === key.id;
          const thisError    = revokeError?.id === key.id ? revokeError.msg : null;

          return (
            <div
              key={key.id}
              style={{
                background: "#ffffff",
                border: "1px solid #e2e8f0",
                borderRadius: "12px",
                padding: "20px",
                display: "flex",
                alignItems: "flex-start",
                gap: "16px",
              }}
            >
              {/* Left: label + meta */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                  <span style={{ fontSize: "14px", fontWeight: 600, color: "#1e293b" }}>
                    {key.label}
                  </span>
                  <StatusBadge status={key.status} />
                </div>
                <p style={{ margin: "0 0 2px", fontSize: "12px", color: "#64748b" }}>
                  Created {formatDate(key.created_at)}
                  {key.created_by_name ? ` by ${key.created_by_name}` : ""}
                </p>
                {key.status === "revoked" && key.revoked_at && (
                  <p style={{ margin: 0, fontSize: "12px", color: "#94a3b8" }}>
                    Revoked {formatDate(key.revoked_at)}
                  </p>
                )}
              </div>

              {/* Center: usage */}
              <div style={{ textAlign: "right", minWidth: "120px" }}>
                <p style={{ margin: "0 0 2px", fontSize: "12px", color: "#64748b" }}>
                  {key.last_used_at
                    ? `Last used ${formatDate(key.last_used_at)}`
                    : "Never used"}
                </p>
                {usageSummary && (
                  <p style={{ margin: 0, fontSize: "12px", color: "#94a3b8" }}>
                    {usageSummary.total_requests.toLocaleString()} calls (30d)
                  </p>
                )}
              </div>

              {/* Right: actions */}
              <div style={{ minWidth: "120px", textAlign: "right" }}>
                {key.status === "active" && (
                  <>
                    {isLastActive ? (
                      <span
                        style={{ fontSize: "11px", color: "#94a3b8", fontStyle: "italic" }}
                        title="Create a replacement key before revoking this one"
                      >
                        Last key
                      </span>
                    ) : isRevoking ? (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px" }}>
                        <span style={{ fontSize: "12px", color: "#64748b" }}>Confirm revoke?</span>
                        <div style={{ display: "flex", gap: "6px" }}>
                          <button
                            onClick={() => confirmRevoke(key.id)}
                            disabled={isPending}
                            style={{
                              padding: "4px 10px",
                              background: "rgba(220,38,38,0.12)",
                              border: "1px solid rgba(220,38,38,0.3)",
                              borderRadius: "6px",
                              color: "#dc2626",
                              fontSize: "12px",
                              fontWeight: 600,
                              cursor: isPending ? "not-allowed" : "pointer",
                            }}
                          >
                            {isPending ? "…" : "Yes"}
                          </button>
                          <button
                            onClick={() => setRevoking(null)}
                            style={{
                              padding: "4px 10px",
                              background: "transparent",
                              border: "1px solid #e2e8f0",
                              borderRadius: "6px",
                              color: "#64748b",
                              fontSize: "12px",
                              cursor: "pointer",
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                        {thisError && (
                          <p style={{ margin: 0, fontSize: "11px", color: "#dc2626" }}>{thisError}</p>
                        )}
                      </div>
                    ) : (
                      <button
                        onClick={() => handleRevoke(key.id)}
                        style={{
                          padding: "5px 12px",
                          background: "transparent",
                          border: "1px solid rgba(220,38,38,0.3)",
                          borderRadius: "6px",
                          color: "#dc2626",
                          fontSize: "12px",
                          fontWeight: 500,
                          cursor: "pointer",
                        }}
                      >
                        Revoke
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}

        {keys.length === 0 && (
          <p style={{ color: "#94a3b8", fontSize: "14px", textAlign: "center", padding: "24px" }}>
            No API keys found.
          </p>
        )}
      </div>
    </div>
  );
}
