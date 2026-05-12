"use client";

import { useState } from "react";
import PasswordInput from "@/components/PasswordInput";

function strengthLevel(pw: string): 0 | 1 | 2 | 3 | 4 {
  if (pw.length === 0) return 0;
  if (pw.length < 8)   return 1;

  const hasLower   = /[a-z]/.test(pw);
  const hasUpper   = /[A-Z]/.test(pw);
  const hasNumber  = /[0-9]/.test(pw);
  const hasSpecial = /[^a-zA-Z0-9]/.test(pw);
  const mixed      = hasLower && hasUpper && hasNumber;

  if (pw.length >= 16 || (pw.length >= 12 && mixed && hasSpecial)) return 4;
  if (pw.length >= 12 && mixed)                                      return 3;
  if (pw.length >= 8)                                                return 2;
  return 1;
}

const STRENGTH_LABELS = ["", "Weak", "Fair", "Good", "Strong"];
const STRENGTH_COLORS = ["", "#ef4444", "#f97316", "#eab308", "#22c55e"];

interface PasswordFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
}

function PasswordField({ id, label, value, onChange, placeholder, autoComplete }: PasswordFieldProps) {
  return (
    <div>
      <label htmlFor={id} className="text-xs text-slate-500 mb-1 block">{label}</label>
      <PasswordInput
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
      />
    </div>
  );
}

export default function ChangePasswordSection() {
  const [current,  setCurrent]  = useState("");
  const [newPw,    setNewPw]    = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [success,  setSuccess]  = useState(false);

  const strength      = strengthLevel(newPw);
  const charCountOk   = newPw.length >= 12;
  const confirmMismatch = confirm.length > 0 && confirm !== newPw;
  const samePwError   = newPw.length > 0 && current.length > 0 && newPw === current;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!current || !newPw || !confirm) {
      setError("All fields are required.");
      return;
    }
    if (newPw.length < 12) {
      setError("New password must be at least 12 characters.");
      return;
    }
    if (newPw !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    if (newPw === current) {
      setError("New password must be different from your current password.");
      return;
    }

    setLoading(true);
    try {
      const res  = await fetch("/api/change-password", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ current_password: current, new_password: newPw }),
      });
      const data = await res.json() as { success?: boolean; error?: string };

      if (!res.ok || !data.success) {
        setError(
          data.error === "incorrect_password"    ? "Your current password is incorrect." :
          data.error === "password_too_short"    ? "New password must be at least 12 characters." :
          data.error === "same_password"         ? "New password must be different from your current password." :
          data.error === "password_recently_used"? "This password was used recently. Please choose a different one." :
          "Something went wrong. Please try again."
        );
        return;
      }

      setCurrent("");
      setNewPw("");
      setConfirm("");
      setSuccess(true);
      setTimeout(() => setSuccess(false), 4000);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-6">
      <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-4">
        Change Password
      </h2>

      <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-4">
        <PasswordField
          id="current-password"
          label="Current password"
          value={current}
          onChange={(v) => { setCurrent(v); setError(null); }}
          placeholder="Your current password"
          autoComplete="current-password"
        />

        <div className="space-y-1.5">
          <PasswordField
            id="new-password"
            label="New password"
            value={newPw}
            onChange={(v) => { setNewPw(v); setError(null); }}
            placeholder="At least 12 characters"
            autoComplete="new-password"
          />

          {/* Strength bar */}
          {newPw.length > 0 && (
            <div className="space-y-1">
              <div className="flex gap-1">
                {[1, 2, 3, 4].map((seg) => (
                  <div
                    key={seg}
                    className="h-1 flex-1 rounded-full transition-colors"
                    style={{
                      background: seg <= strength ? STRENGTH_COLORS[strength] : "#e2e8f0",
                    }}
                  />
                ))}
              </div>
              <p className="text-xs" style={{ color: STRENGTH_COLORS[strength] }}>
                {STRENGTH_LABELS[strength]}
              </p>
            </div>
          )}

          {/* Character count helper */}
          <p className={`text-xs ${charCountOk ? "text-green-600" : "text-slate-400"}`}>
            {newPw.length}/12 characters minimum
          </p>

          {samePwError && (
            <p className="text-xs text-red-500">New password must be different from your current password.</p>
          )}
        </div>

        <div className="space-y-1">
          <PasswordField
            id="confirm-password"
            label="Confirm new password"
            value={confirm}
            onChange={(v) => { setConfirm(v); setError(null); }}
            placeholder="Repeat new password"
            autoComplete="new-password"
          />
          {confirmMismatch && (
            <p className="text-xs text-red-500">Passwords do not match.</p>
          )}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {success && (
          <p className="text-sm text-green-600 font-medium">Password updated successfully.</p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-teal-600 hover:bg-teal-500 disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
        >
          {loading ? "Updating…" : "Update Password"}
        </button>
      </form>
    </div>
  );
}
