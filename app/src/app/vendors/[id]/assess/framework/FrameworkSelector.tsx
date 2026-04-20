"use client";

import { useRouter } from "next/navigation";
import type { Framework } from "@/lib/api";

export function FrameworkSelector({
  vendorId,
  frameworks,
}: {
  vendorId: string;
  frameworks: Framework[];
}) {
  const router = useRouter();

  if (frameworks.length === 0) {
    return (
      <div
        className="bg-brand-surface border border-brand-line rounded-xl p-8 text-center"
      >
        <p className="text-sm mb-2" style={{ color: "#94a3b8" }}>
          No active frameworks found.
        </p>
        <a
          href="/frameworks"
          className="text-xs font-medium hover:underline"
          style={{ color: "#00c4b4" }}
        >
          Activate a framework
        </a>
      </div>
    );
  }

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide mb-4" style={{ color: "#94a3b8" }}>
        Select a Framework
      </p>
      <div className="space-y-2">
        {frameworks.map((f) => (
          <button
            key={f.id}
            onClick={() =>
              router.push(
                `/vendors/${vendorId}/assess/framework?frameworkId=${encodeURIComponent(f.id)}`
              )
            }
            className="w-full text-left bg-brand-surface border border-brand-line rounded-xl p-4 hover:border-teal-700/50 transition-colors"
          >
            <p className="text-sm font-semibold" style={{ color: "#f1f5f9" }}>
              {f.name}
            </p>
            <p className="text-xs mt-0.5" style={{ color: "#475569" }}>
              v{f.version}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}
