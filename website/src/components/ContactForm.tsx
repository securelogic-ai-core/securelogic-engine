"use client";

import { useState, type FormEvent } from "react";

// ── Select options (from the build spec) ───────────────────────────────
const ROLES = [
  "CISO / Head of Security",
  "GRC / Compliance",
  "Security / Threat Intelligence",
  "Risk Manager",
  "IT / Security Operations",
  "Other",
];
const TEAM_SIZES = ["1–5", "6–20", "21–100", "100+"];
const USE_CASES = [
  "Vendor risk",
  "AI governance",
  "Compliance / audits",
  "Intelligence Brief",
  "Enterprise platform evaluation",
  "Other",
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface FormState {
  fullName: string;
  email: string;
  company: string;
  role: string;
  teamSize: string;
  useCase: string;
  message: string;
}

const EMPTY: FormState = {
  fullName: "",
  email: "",
  company: "",
  role: "",
  teamSize: "",
  useCase: "",
  message: "",
};

const fieldClass =
  "w-full rounded-[10px] bg-bg border border-hairline px-3.5 py-2.5 text-sm text-text placeholder:text-text-muted/60 focus:border-accent focus:outline-none transition-colors";
const labelClass = "block text-xs font-medium text-text-muted mb-1.5";

export function ContactForm() {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [submitted, setSubmitted] = useState(false);

  function update<K extends keyof FormState>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  function validate(): boolean {
    const next: Partial<Record<keyof FormState, string>> = {};
    if (!form.fullName.trim()) next.fullName = "Please enter your name.";
    if (!form.email.trim()) next.email = "Please enter your work email.";
    else if (!EMAIL_RE.test(form.email.trim())) next.email = "Please enter a valid email address.";
    if (!form.company.trim()) next.company = "Please enter your company.";
    if (!form.message.trim()) next.message = "Please tell us a little about what you need.";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validate()) return;

    // TODO(backend): replace this mailto channel with a POST to a real
    // contact endpoint (e.g. /api/public/contact) once it is built. Until
    // then we do NOT fake a network success — we open a genuine, prefilled
    // email to the team so the message actually reaches someone.
    const lines = [
      `Name: ${form.fullName}`,
      `Email: ${form.email}`,
      `Company: ${form.company}`,
      form.role ? `Role: ${form.role}` : null,
      form.teamSize ? `Team size: ${form.teamSize}` : null,
      form.useCase ? `Primary use case: ${form.useCase}` : null,
      "",
      form.message,
    ].filter(Boolean);

    const subject = encodeURIComponent(`Demo request — ${form.company}`);
    const body = encodeURIComponent(lines.join("\n"));
    window.location.href = `mailto:hello@securelogicai.com?subject=${subject}&body=${body}`;
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="card p-7" role="status" aria-live="polite">
        <span className="flex w-10 h-10 rounded-full bg-accent/15 text-accent items-center justify-center mb-4">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        </span>
        <h3 className="text-text font-bold text-lg mb-2">Your message is ready to send</h3>
        <p className="text-text-body text-sm leading-relaxed">
          We&apos;ve opened a prefilled email to our team. Send it and we&apos;ll reply within
          one business day. If your mail client didn&apos;t open, email us directly at{" "}
          <a href="mailto:hello@securelogicai.com" className="text-accent hover:text-accent-hover">
            hello@securelogicai.com
          </a>
          .
        </p>
        <button
          type="button"
          onClick={() => {
            setForm(EMPTY);
            setSubmitted(false);
          }}
          className="btn-outline mt-6"
        >
          Send another message
        </button>
      </div>
    );
  }

  return (
    <form id="contact-form" onSubmit={handleSubmit} noValidate className="card p-6 sm:p-7 space-y-5">
      <div className="grid sm:grid-cols-2 gap-5">
        <div>
          <label htmlFor="c-name" className={labelClass}>
            Full name <span className="text-danger">*</span>
          </label>
          <input
            id="c-name"
            type="text"
            autoComplete="name"
            value={form.fullName}
            onChange={(e) => update("fullName", e.target.value)}
            aria-invalid={!!errors.fullName}
            aria-describedby={errors.fullName ? "c-name-err" : undefined}
            className={fieldClass}
          />
          {errors.fullName && (
            <p id="c-name-err" className="text-danger text-xs mt-1.5">{errors.fullName}</p>
          )}
        </div>
        <div>
          <label htmlFor="c-email" className={labelClass}>
            Work email <span className="text-danger">*</span>
          </label>
          <input
            id="c-email"
            type="email"
            autoComplete="email"
            value={form.email}
            onChange={(e) => update("email", e.target.value)}
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? "c-email-err" : undefined}
            className={fieldClass}
          />
          {errors.email && (
            <p id="c-email-err" className="text-danger text-xs mt-1.5">{errors.email}</p>
          )}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-5">
        <div>
          <label htmlFor="c-company" className={labelClass}>
            Company <span className="text-danger">*</span>
          </label>
          <input
            id="c-company"
            type="text"
            autoComplete="organization"
            value={form.company}
            onChange={(e) => update("company", e.target.value)}
            aria-invalid={!!errors.company}
            aria-describedby={errors.company ? "c-company-err" : undefined}
            className={fieldClass}
          />
          {errors.company && (
            <p id="c-company-err" className="text-danger text-xs mt-1.5">{errors.company}</p>
          )}
        </div>
        <div>
          <label htmlFor="c-role" className={labelClass}>Role</label>
          <select
            id="c-role"
            value={form.role}
            onChange={(e) => update("role", e.target.value)}
            className={fieldClass}
          >
            <option value="">Select your role</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-5">
        <div>
          <label htmlFor="c-team" className={labelClass}>Team size</label>
          <select
            id="c-team"
            value={form.teamSize}
            onChange={(e) => update("teamSize", e.target.value)}
            className={fieldClass}
          >
            <option value="">Select team size</option>
            {TEAM_SIZES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="c-usecase" className={labelClass}>Primary use case</label>
          <select
            id="c-usecase"
            value={form.useCase}
            onChange={(e) => update("useCase", e.target.value)}
            className={fieldClass}
          >
            <option value="">Select a use case</option>
            {USE_CASES.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="c-message" className={labelClass}>
          Message <span className="text-danger">*</span>
        </label>
        <textarea
          id="c-message"
          rows={4}
          value={form.message}
          onChange={(e) => update("message", e.target.value)}
          aria-invalid={!!errors.message}
          aria-describedby={errors.message ? "c-message-err" : undefined}
          className={`${fieldClass} resize-y`}
          placeholder="A few vendors, an obligation or two, and what you'd like to see."
        />
        {errors.message && (
          <p id="c-message-err" className="text-danger text-xs mt-1.5">{errors.message}</p>
        )}
      </div>

      <button type="submit" className="btn-primary w-full">Send message</button>
      <p className="text-xs text-text-muted text-center">
        We reply within one business day.
      </p>
    </form>
  );
}
