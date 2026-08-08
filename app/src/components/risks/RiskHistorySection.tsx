"use client";

/**
 * RiskHistorySection (RR-3) — chronological audit trail for a single
 * risk. The original implementation was promoted to the shared
 * HistorySection (vendors, controls, obligations, and AI systems now
 * render the same trail); this wrapper keeps the established import
 * site and prop shape stable.
 */

import { HistorySection } from "@/components/HistorySection";

export function RiskHistorySection({ riskId }: { riskId: string }) {
  return <HistorySection resourcePath="risks" resourceId={riskId} />;
}
