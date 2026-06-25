"use client";

import { useState, type FormEvent } from "react";

// Public, unauthenticated endpoint on the SecureLogic engine API.
// Contract: POST { email, name? } -> 201 { ok: true }
//   409 { error: "already_subscribed" } · 400 { error: "invalid_email" }
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "https://api.securelogicai.com";

type Status = "idle" | "submitting" | "success" | "error";

const MESSAGES: Record<string, string> = {
  success: "You're subscribed! First brief arrives Monday.",
  already_subscribed: "You're already on the list.",
  invalid_email: "Please enter a valid email address.",
  generic: "Something went wrong. Please try again.",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function BriefSignupForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!EMAIL_RE.test(email.trim())) {
      setStatus("error");
      setMessage(MESSAGES.invalid_email);
      return;
    }

    setStatus("submitting");
    setMessage("");

    try {
      const res = await fetch(`${API_URL}/api/public/brief-signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), name: name.trim() || undefined }),
      });

      if (res.ok) {
        setStatus("success");
        setMessage(MESSAGES.success);
        setName("");
        setEmail("");
        return;
      }

      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setStatus("error");
      setMessage(MESSAGES[data?.error ?? "generic"] ?? MESSAGES.generic);
    } catch {
      setStatus("error");
      setMessage(MESSAGES.generic);
    }
  }

  if (status === "success") {
    return (
      <div
        className="card p-6 flex items-start gap-3"
        role="status"
        aria-live="polite"
      >
        <span className="mt-0.5 flex-shrink-0 w-6 h-6 rounded-full bg-accent/15 text-accent flex items-center justify-center">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        </span>
        <div>
          <p className="text-text font-semibold text-sm">{MESSAGES.success}</p>
          <p className="text-text-muted text-xs mt-1">
            Check your inbox to confirm your address.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form id="brief-signup" onSubmit={handleSubmit} noValidate className="card p-5 sm:p-6">
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor="brief-name" className="block text-xs font-medium text-text-muted mb-1.5">
            Name <span className="text-text-muted/60">(optional)</span>
          </label>
          <input
            id="brief-name"
            name="name"
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-[10px] bg-bg border border-hairline px-3.5 py-2.5 text-sm text-text placeholder:text-text-muted/60 focus:border-accent focus:outline-none transition-colors"
            placeholder="Jordan Rivera"
          />
        </div>
        <div>
          <label htmlFor="brief-email" className="block text-xs font-medium text-text-muted mb-1.5">
            Work email <span className="text-danger">*</span>
          </label>
          <input
            id="brief-email"
            name="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={status === "error"}
            aria-describedby="brief-signup-status"
            className="w-full rounded-[10px] bg-bg border border-hairline px-3.5 py-2.5 text-sm text-text placeholder:text-text-muted/60 focus:border-accent focus:outline-none transition-colors"
            placeholder="you@company.com"
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={status === "submitting"}
        className="btn-primary w-full mt-4 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {status === "submitting" ? "Subscribing…" : "Get the Free Brief"}
      </button>

      <p
        id="brief-signup-status"
        role="status"
        aria-live="polite"
        className={`text-xs mt-3 min-h-[1rem] ${status === "error" ? "text-danger" : "text-text-muted"}`}
      >
        {message || "No credit card required. First brief arrives Monday."}
      </p>
    </form>
  );
}
