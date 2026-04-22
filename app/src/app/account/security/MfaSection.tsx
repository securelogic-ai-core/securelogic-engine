"use client";

import { useState } from "react";
import Image from "next/image";

type Step = "idle" | "qr" | "confirm" | "backup" | "disabling";

interface MfaSectionProps {
  totpEnabled: boolean;
}

export default function MfaSection({ totpEnabled: initialEnabled }: MfaSectionProps) {
  const [enabled,    setEnabled]    = useState(initialEnabled);
  const [step,       setStep]       = useState<Step>("idle");
  const [qrUrl,      setQrUrl]      = useState("");
  const [manualKey,  setManualKey]  = useState("");
  const [code,       setCode]       = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [disablePass, setDisablePass] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [error,      setError]      = useState<string | null>(null);
  const [loading,    setLoading]    = useState(false);
  const [copied,     setCopied]     = useState(false);

  async function startSetup() {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch("/api/mfa/setup", { method: "POST" });
      const data = await res.json() as { qr_code_url?: string; manual_entry_key?: string; error?: string };
      if (!res.ok || data.error) {
        setError(data.error === "mfa_already_enabled" ? "MFA is already enabled." : "Failed to start setup.");
        setLoading(false);
        return;
      }
      setQrUrl(data.qr_code_url ?? "");
      setManualKey(data.manual_entry_key ?? "");
      setCode("");
      setStep("qr");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function confirmSetup() {
    if (!code.trim()) { setError("Enter the 6-digit code from your authenticator."); return; }
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch("/api/mfa/verify-setup", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ code: code.trim() })
      });
      const data = await res.json() as { backup_codes?: string[]; error?: string; detail?: string };
      if (!res.ok || data.error) {
        setError(
          data.error === "invalid_code" ? "Incorrect code. Try again." :
          data.detail                   ? data.detail :
          data.error                    ? data.error :
          "Verification failed."
        );
        setLoading(false);
        return;
      }
      if (!data.backup_codes?.length) {
        setError("Backup codes could not be generated. Please try again.");
        return;
      }
      setBackupCodes(data.backup_codes);
      setStep("backup");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function disableMfa() {
    if (!disablePass) { setError("Enter your current password."); return; }
    if (!disableCode.trim()) { setError("Enter the 6-digit code from your authenticator."); return; }
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch("/api/mfa/disable", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ password: disablePass, code: disableCode.trim() })
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || !data.success) {
        setError(
          data.error === "invalid_credentials" ? "Incorrect password." :
          data.error === "invalid_code"        ? "Incorrect authenticator code." :
          "Failed to disable MFA."
        );
        setLoading(false);
        return;
      }
      setEnabled(false);
      setStep("idle");
      setDisablePass("");
      setDisableCode("");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function copyAll() {
    void navigator.clipboard.writeText(backupCodes.join("\n")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function close() {
    setStep("idle");
    setError(null);
    setCode("");
    setDisablePass("");
    setDisableCode("");
  }

  function finishSetup() {
    setEnabled(true);
    setStep("idle");
    setBackupCodes([]);
    setCopied(false);
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
      <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-4">
        Security
      </h2>

      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-lg" role="img" aria-label="shield">🛡️</span>
          <div>
            <p className="text-sm font-medium text-slate-800">Two-factor authentication</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {enabled
                ? "Enabled — your account is protected with TOTP."
                : "Not enabled — protect your account with an authenticator app."}
            </p>
          </div>
        </div>

        {!enabled && step === "idle" && (
          <button
            onClick={() => void startSetup()}
            disabled={loading}
            className="flex-shrink-0 text-sm font-medium text-teal-600 border border-teal-300 hover:bg-teal-50 px-4 py-1.5 rounded-lg transition-colors disabled:opacity-50"
          >
            {loading ? "Loading…" : "Enable 2FA"}
          </button>
        )}

        {enabled && step === "idle" && (
          <button
            onClick={() => { setStep("disabling"); setError(null); }}
            className="flex-shrink-0 text-sm font-medium text-slate-500 border border-slate-200 hover:border-slate-400 px-4 py-1.5 rounded-lg transition-colors"
          >
            Disable
          </button>
        )}
      </div>

      {error && (
        <p className="mt-3 text-sm text-red-600">{error}</p>
      )}

      {/* ── Setup step 1: QR code ── */}
      {step === "qr" && (
        <div className="mt-5 border-t border-slate-100 pt-5 space-y-4">
          <p className="text-sm text-slate-700 font-medium">Step 1 — Scan this QR code with your authenticator app</p>
          {qrUrl && (
            <div className="flex justify-center">
              <Image src={qrUrl} alt="TOTP QR Code" width={200} height={200} unoptimized />
            </div>
          )}
          <details className="text-xs text-slate-500">
            <summary className="cursor-pointer select-none">Can&apos;t scan? Enter this key manually</summary>
            <p className="mt-2 font-mono break-all bg-slate-50 border border-slate-200 rounded px-3 py-2 text-slate-700 text-xs">
              {manualKey}
            </p>
          </details>
          <p className="text-sm text-slate-700 font-medium">Step 2 — Enter the 6-digit code to confirm</p>
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => { setCode(e.target.value); setError(null); }}
            placeholder="000000"
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-teal-400"
          />
          <div className="flex gap-3">
            <button
              onClick={() => void confirmSetup()}
              disabled={loading || code.length < 6}
              className="flex-1 bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
            >
              {loading ? "Verifying…" : "Verify & Enable"}
            </button>
            <button onClick={close} className="text-sm text-slate-500 hover:text-slate-700 px-4 py-2">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* ── Setup step 2: backup codes ── */}
      {step === "backup" && (
        <div className="mt-5 border-t border-slate-100 pt-5 space-y-4">
          {backupCodes.length === 0 ? (
            <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
              <p className="text-sm font-semibold text-red-800 mb-1">Backup codes unavailable</p>
              <p className="text-xs text-red-700">
                Something went wrong — backup codes could not be generated. Please disable and re-enable MFA to try again.
              </p>
            </div>
          ) : (
            <>
              <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
                <p className="text-sm font-semibold text-amber-800 mb-1">Save these backup codes</p>
                <p className="text-xs text-amber-700">
                  Store them somewhere safe. Each code can only be used once and will not be shown again.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {backupCodes.map((c) => (
                  <span key={c} className="font-mono text-sm bg-slate-50 border border-slate-200 rounded px-3 py-1.5 text-center tracking-wider">
                    {c}
                  </span>
                ))}
              </div>
              <button
                onClick={copyAll}
                className="w-full border border-slate-300 hover:border-slate-400 text-slate-700 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                {copied ? "Copied!" : "Copy all codes"}
              </button>
            </>
          )}
          <button
            onClick={finishSetup}
            className="w-full bg-teal-600 hover:bg-teal-500 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            Done
          </button>
        </div>
      )}

      {/* ── Disable MFA confirmation ── */}
      {step === "disabling" && (
        <div className="mt-5 border-t border-slate-100 pt-5 space-y-4">
          <p className="text-sm text-slate-700 font-medium">Confirm to disable two-factor authentication</p>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Current password</label>
            <input
              type="password"
              value={disablePass}
              onChange={(e) => { setDisablePass(e.target.value); setError(null); }}
              placeholder="Your password"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 mb-1 block">Authenticator code</label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={disableCode}
              onChange={(e) => { setDisableCode(e.target.value); setError(null); }}
              placeholder="000000"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-teal-400"
            />
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => void disableMfa()}
              disabled={loading}
              className="flex-1 border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-50 text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
            >
              {loading ? "Disabling…" : "Disable 2FA"}
            </button>
            <button onClick={close} className="text-sm text-slate-500 hover:text-slate-700 px-4 py-2">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
