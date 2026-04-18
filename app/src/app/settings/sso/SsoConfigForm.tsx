"use client";

import { useState, useTransition } from "react";
import { saveSsoConfigAction } from "./actions";

interface SsoConfig {
  idp_entity_id: string;
  idp_sso_url: string;
  idp_certificate: string;
  sp_entity_id: string;
  is_enforced: boolean;
}

interface Props {
  orgId: string;
  existingConfig?: SsoConfig;
}

export function SsoConfigForm({ orgId, existingConfig }: Props) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [idpEntityId,   setIdpEntityId]   = useState(existingConfig?.idp_entity_id   ?? "");
  const [idpSsoUrl,     setIdpSsoUrl]     = useState(existingConfig?.idp_sso_url     ?? "");
  const [idpCert,       setIdpCert]       = useState(existingConfig?.idp_certificate ?? "");
  const [spEntityId,    setSpEntityId]    = useState(existingConfig?.sp_entity_id    ?? orgId);
  const [isEnforced,    setIsEnforced]    = useState(existingConfig?.is_enforced     ?? false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await saveSsoConfigAction({
        idp_entity_id:   idpEntityId.trim(),
        idp_sso_url:     idpSsoUrl.trim(),
        idp_certificate: idpCert.trim(),
        sp_entity_id:    spEntityId.trim(),
        is_enforced:     isEnforced,
      });
      if (result?.error) setError(result.error);
    });
  }

  return (
    <form onSubmit={handleSubmit}>
      {error && (
        <div style={{
          background: "rgba(220,38,38,0.1)",
          border: "1px solid rgba(220,38,38,0.3)",
          borderRadius: "8px",
          padding: "12px 16px",
          marginBottom: "20px",
          color: "#fca5a5",
          fontSize: "13px",
        }}>
          {error}
        </div>
      )}

      <Field
        label="IdP Entity ID *"
        value={idpEntityId}
        onChange={setIdpEntityId}
        placeholder="https://your-idp.com/..."
      />
      <Field
        label="IdP SSO URL *"
        value={idpSsoUrl}
        onChange={setIdpSsoUrl}
        placeholder="https://your-idp.com/sso/saml"
      />
      <div style={{ marginBottom: "20px" }}>
        <label style={labelStyle}>IdP Certificate *</label>
        <textarea
          value={idpCert}
          onChange={(e) => setIdpCert(e.target.value)}
          rows={6}
          placeholder={"-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"}
          required
          style={{
            width: "100%",
            boxSizing: "border-box",
            background: "#060d18",
            border: "1px solid #1e2d45",
            borderRadius: "8px",
            padding: "12px 14px",
            fontSize: "13px",
            fontFamily: "monospace",
            color: "#f1f5f9",
            outline: "none",
            resize: "vertical",
          }}
        />
      </div>
      <Field
        label="SP Entity ID *"
        value={spEntityId}
        onChange={setSpEntityId}
        placeholder={orgId}
        hint="Your side's identifier. Use your domain or org ID."
      />

      {/* Enforcement toggle */}
      <div style={{ marginBottom: "24px" }}>
        <label style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={isEnforced}
            onChange={(e) => setIsEnforced(e.target.checked)}
            style={{ marginTop: "2px", accentColor: "#00c4b4" }}
          />
          <div>
            <span style={{ fontSize: "13px", fontWeight: 600, color: "#cbd5e1" }}>
              Enforce SSO
            </span>
            <p style={{ fontSize: "12px", color: "#64748b", margin: "2px 0 0" }}>
              Require all users to sign in via SSO. Password login will be disabled.
            </p>
            {isEnforced && (
              <p style={{
                fontSize: "12px",
                color: "#fbbf24",
                margin: "6px 0 0",
                padding: "6px 10px",
                background: "rgba(251,191,36,0.08)",
                borderRadius: "6px",
                border: "1px solid rgba(251,191,36,0.2)",
              }}>
                Warning: Enforcing SSO will prevent password-based login for all team members.
              </p>
            )}
          </div>
        </label>
      </div>

      <button
        type="submit"
        disabled={isPending}
        style={{
          background: isPending ? "#009e91" : "#00c4b4",
          color: "#fff",
          fontWeight: 600,
          fontSize: "14px",
          padding: "10px 24px",
          borderRadius: "8px",
          border: "none",
          cursor: isPending ? "not-allowed" : "pointer",
          opacity: isPending ? 0.7 : 1,
        }}
      >
        {isPending ? "Saving…" : "Save Configuration"}
      </button>
    </form>
  );
}

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "12px",
  fontWeight: 600,
  color: "#64748b",
  marginBottom: "6px",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

function Field({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <div style={{ marginBottom: "20px" }}>
      <label style={labelStyle}>{label}</label>
      {hint && (
        <p style={{ fontSize: "12px", color: "#64748b", margin: "0 0 6px" }}>{hint}</p>
      )}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required
        style={{
          width: "100%",
          boxSizing: "border-box",
          background: "#060d18",
          border: "1px solid #1e2d45",
          borderRadius: "8px",
          padding: "12px 14px",
          fontSize: "14px",
          color: "#f1f5f9",
          outline: "none",
        }}
      />
    </div>
  );
}
