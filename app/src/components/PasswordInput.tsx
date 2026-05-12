"use client";

/**
 * PasswordInput — a label-less <input> wrapper with a "show password" toggle.
 *
 * Drop-in for any `<input type="password" />`: it forwards every native input
 * prop (value / onChange / placeholder / autoComplete / required / disabled /
 * id / name / className / style / onFocus / onBlur / …) straight through to the
 * inner <input>, so it slots into both the dark inline-styled auth pages
 * (via AuthInput) and the Tailwind-styled account pages with no per-call
 * styling changes.
 *
 * Behaviour:
 *   - Starts hidden (type="password"); the toggle reveals it (type="text").
 *     No persistence — a reload resets to hidden.
 *   - The toggle is a real <button type="button"> (so it never submits the
 *     form), keyboard-focusable, with an aria-label that reflects the current
 *     state ("Show password" / "Hide password") and aria-pressed. preventDefault
 *     on mousedown keeps focus on the input when the toggle is clicked.
 *   - The relative-wrapper / absolute-button layout doesn't sit on the input
 *     itself, so browser autofill is unaffected; an always-applied right padding
 *     keeps the typed value clear of the icon.
 *   - The eye icon is intentionally unobtrusive — a light slate gray, no brand
 *     color; it's a utility, not a feature.
 *
 * Icon style matches the codebase convention (inline lucide-style SVGs; no icon
 * library) — these are the same eye / eye-off paths that ChangePasswordSection
 * previously inlined.
 */

import { useState, type CSSProperties, type InputHTMLAttributes } from "react";

/** Right padding reserved on the input so the typed value never runs under the toggle. */
const EYE_RESERVED_PADDING_PX = 40;

function EyeIcon({ visible }: { visible: boolean }): JSX.Element {
  return visible ? (
    // eye-off — shown while the password is visible (click → hide)
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  ) : (
    // eye — shown while the password is hidden (click → show)
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

export default function PasswordInput({ style, ...inputProps }: PasswordInputProps): JSX.Element {
  const [show, setShow] = useState(false);

  // Spread the caller's style first so `paddingRight` (longhand) wins for the
  // right side regardless of any `padding` shorthand they passed. box-sizing is
  // border-box on every call site (AuthInput sets it; Tailwind preflight sets
  // it globally), so reserving padding doesn't change the box width.
  const inputStyle: CSSProperties = { ...style, paddingRight: EYE_RESERVED_PADDING_PX };

  return (
    <div style={{ position: "relative" }}>
      <input {...inputProps} type={show ? "text" : "password"} style={inputStyle} />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        onMouseDown={(e) => e.preventDefault()}
        aria-label={show ? "Hide password" : "Show password"}
        aria-pressed={show}
        style={{
          position: "absolute",
          right: 10,
          top: "50%",
          transform: "translateY(-50%)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 2,
          margin: 0,
          border: "none",
          background: "transparent",
          color: "#94a3b8",
          cursor: "pointer",
          lineHeight: 0,
        }}
      >
        <EyeIcon visible={show} />
      </button>
    </div>
  );
}
