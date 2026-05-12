"use client";

/**
 * PdfPreview — renders a vendor-assurance SOC PDF with react-pdf, fed from the
 * same-origin stream-through proxy (app/src/app/api/vendor-assurance/[documentId]/pdf).
 *
 * Dynamic-imported with `ssr: false` from the document page — react-pdf / pdf.js
 * touch DOM APIs and cannot render on the server. The pdf.js worker is served
 * from /pdf.worker.min.mjs (copied into app/public/ at the version pinned by
 * app/package-lock.json; keep it in sync with react-pdf's bundled pdfjs-dist).
 *
 * No span highlighting yet — the text/annotation layers are rendered (so future
 * overlay work in Package 1.5 has anchors) but nothing is highlighted.
 */

import { useCallback, useMemo, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/esm/Page/AnnotationLayer.css";
import "react-pdf/dist/esm/Page/TextLayer.css";

// Same-origin worker — matches react-pdf's bundled pdfjs-dist build.
pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

type Props = {
  /** Same-origin proxy URL, e.g. /api/vendor-assurance/<id>/pdf */
  fileUrl: string;
  /** Rendered page width in CSS px. */
  width?: number;
};

const PANEL_BG = "#0b1220";
const BORDER = "#374151";
const TEXT_MUTED = "#9ca3af";

export default function PdfPreview({ fileUrl, width = 560 }: Props): JSX.Element {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [loadError, setLoadError] = useState<string | null>(null);

  // react-pdf re-loads the document if the `file` prop identity changes — keep
  // it stable.
  const file = useMemo(() => ({ url: fileUrl }), [fileUrl]);

  const onLoadSuccess = useCallback(({ numPages: n }: { numPages: number }) => {
    setNumPages(n);
    setPageNumber((p) => Math.min(Math.max(1, p), n));
    setLoadError(null);
  }, []);

  const onLoadError = useCallback((err: Error) => {
    setLoadError(err?.message ?? "Failed to load PDF");
  }, []);

  const goPrev = () => setPageNumber((p) => Math.max(1, p - 1));
  const goNext = () => setPageNumber((p) => (numPages ? Math.min(numPages, p + 1) : p));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          fontSize: 13,
          color: TEXT_MUTED,
        }}
      >
        <span>Source PDF</span>
        {numPages !== null && !loadError && (
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button type="button" onClick={goPrev} disabled={pageNumber <= 1} style={navBtn(pageNumber <= 1)}>
              ‹ Prev
            </button>
            <span style={{ minWidth: 84, textAlign: "center" }}>
              Page {pageNumber} / {numPages}
            </span>
            <button
              type="button"
              onClick={goNext}
              disabled={numPages !== null && pageNumber >= numPages}
              style={navBtn(numPages !== null && pageNumber >= numPages)}
            >
              Next ›
            </button>
          </span>
        )}
      </div>

      <div
        style={{
          border: `1px solid ${BORDER}`,
          borderRadius: 8,
          background: PANEL_BG,
          overflow: "auto",
          maxHeight: "calc(100vh - 220px)",
          display: "flex",
          justifyContent: "center",
        }}
      >
        {loadError ? (
          <div style={{ padding: 24, color: "#fca5a5", fontSize: 13 }}>
            Could not render the PDF in-browser ({loadError}).{" "}
            <a href={fileUrl} target="_blank" rel="noopener noreferrer" style={{ color: "#93c5fd" }}>
              Open it in a new tab
            </a>
            .
          </div>
        ) : (
          <Document
            file={file}
            onLoadSuccess={onLoadSuccess}
            onLoadError={onLoadError}
            loading={<div style={{ padding: 24, color: TEXT_MUTED, fontSize: 13 }}>Loading PDF…</div>}
            error={<div style={{ padding: 24, color: "#fca5a5", fontSize: 13 }}>Failed to load PDF.</div>}
          >
            <Page
              pageNumber={pageNumber}
              width={width}
              renderAnnotationLayer
              renderTextLayer
              loading={<div style={{ padding: 24, color: TEXT_MUTED, fontSize: 13 }}>Rendering page…</div>}
            />
          </Document>
        )}
      </div>
    </div>
  );
}

function navBtn(disabled: boolean): React.CSSProperties {
  return {
    padding: "4px 10px",
    borderRadius: 4,
    border: `1px solid ${BORDER}`,
    background: "transparent",
    color: disabled ? "#4b5563" : "#93c5fd",
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: 12,
  };
}
