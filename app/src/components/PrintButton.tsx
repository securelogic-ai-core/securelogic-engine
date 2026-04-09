"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="print:hidden inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-slate-600 transition-colors"
      aria-label="Print this brief"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 16 16"
        fill="currentColor"
        className="w-3.5 h-3.5"
      >
        <path
          fillRule="evenodd"
          d="M4 2a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h1v1a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-1h1a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H4Zm1 7H4a.5.5 0 0 1-.5-.5V4A.5.5 0 0 1 4 3.5h8a.5.5 0 0 1 .5.5v4.5a.5.5 0 0 1-.5.5h-1V8a1 1 0 0 0-1-1H6a1 1 0 0 0-1 1v1Zm1 0v3h4V9H6Z"
          clipRule="evenodd"
        />
      </svg>
      Print
    </button>
  );
}
