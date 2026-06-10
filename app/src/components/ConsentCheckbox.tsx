"use client";

import type { ConsentDocumentType } from "@/lib/api";

/**
 * Canonical labels + marketing-site URLs for the three legal documents.
 * Single source of truth shared by the signup/invite consent checkbox and the
 * ConsentInterstitial. Keep the keys in sync with the engine's DOCUMENT_TYPES.
 */
export const LEGAL_DOC_LINKS: Record<ConsentDocumentType, { label: string; href: string }> = {
  terms_of_service: { label: "Terms of Service", href: "https://securelogicai.com/terms/" },
  privacy_policy: { label: "Privacy Policy", href: "https://securelogicai.com/privacy/" },
  ai_transparency_policy: {
    label: "AI Transparency & Responsible Use Policy",
    href: "https://securelogicai.com/ai-policy/",
  },
};

function DocLink({ doc }: { doc: ConsentDocumentType }) {
  const { label, href } = LEGAL_DOC_LINKS[doc];
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{ color: "#00c4b4", textDecoration: "underline", textUnderlineOffset: "2px" }}
    >
      {label}
    </a>
  );
}

interface Props {
  id?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/**
 * Required legal-consent checkbox used on the signup and invite-acceptance
 * forms. The label links each policy to its public marketing-site page (opens
 * in a new tab). Callers gate their submit button on `checked`.
 */
export default function ConsentCheckbox({ id = "acceptedTerms", checked, onChange }: Props) {
  return (
    <label
      htmlFor={id}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "10px",
        margin: "0 0 24px",
        fontSize: "14px",
        lineHeight: 1.5,
        color: "#cbd5e1",
        cursor: "pointer",
      }}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        required
        style={{
          width: "18px",
          height: "18px",
          marginTop: "1px",
          accentColor: "#00c4b4",
          flexShrink: 0,
          cursor: "pointer",
        }}
      />
      <span>
        I agree to the <DocLink doc="terms_of_service" />, <DocLink doc="privacy_policy" />, and{" "}
        <DocLink doc="ai_transparency_policy" />.
      </span>
    </label>
  );
}
