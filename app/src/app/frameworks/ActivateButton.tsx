"use client";

import { useState } from "react";
import { activateFramework } from "./actions";

interface ActivateButtonProps {
  templateKey: string;
  frameworkName: string;
}

export function ActivateButton({ templateKey, frameworkName }: ActivateButtonProps) {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setIsPending(true);
    setError(null);
    const result = await activateFramework(templateKey);
    if (result && "error" in result) {
      setError(result.error);
      setIsPending(false);
    }
    // On success, activateFramework redirects — component unmounts naturally
  }

  return (
    <div>
      <button
        onClick={handleClick}
        disabled={isPending}
        className="inline-flex items-center justify-center px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        style={{ background: "#00c4b4", color: "#0a0f1a" }}
      >
        {isPending ? "Activating…" : `Activate ${frameworkName}`}
      </button>
      {error && (
        <p className="mt-2 text-xs" style={{ color: "#fca5a5" }}>
          {error}
        </p>
      )}
    </div>
  );
}
