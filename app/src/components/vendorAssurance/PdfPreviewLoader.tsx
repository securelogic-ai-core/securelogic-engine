"use client";

/**
 * PdfPreviewLoader — a "use client" shim whose only job is to `next/dynamic`
 * the real PdfPreview with `ssr: false`. `ssr: false` is not permitted on a
 * `next/dynamic` call inside a Server Component, so the document page imports
 * THIS, and this imports PdfPreview. react-pdf / pdf.js reference browser-only
 * globals at module-eval time, so it must never be evaluated during SSR.
 */

import dynamic from "next/dynamic";

const PdfPreview = dynamic(() => import("./PdfPreview"), {
  ssr: false,
  loading: () => (
    <div style={{ padding: 24, color: "#9ca3af", fontSize: 13, border: "1px solid #374151", borderRadius: 8, background: "#0b1220" }}>
      Loading PDF viewer…
    </div>
  ),
});

export default function PdfPreviewLoader(props: { fileUrl: string; width?: number }): JSX.Element {
  return <PdfPreview {...props} />;
}
