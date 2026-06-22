"use server";

import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import {
  getVendor,
  getVendorSignalContext,
  type VendorSignalContext,
} from "@/lib/api";
import { AssessmentForm } from "./AssessmentForm";

export default async function VendorAssessPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const entitlementLevel = session.entitlementLevel ?? "free";
  const isPlatformUser =
    entitlementLevel === "premium" ||
    entitlementLevel === "platform" ||
    entitlementLevel === "team";
  if (!isPlatformUser) redirect("/dashboard");

  const [vendor, signalContext] = await Promise.all([
    getVendor(token, id),
    getVendorSignalContext(token, id),
  ]);

  if (!vendor) redirect("/vendors");

  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <Link
        href={`/vendors/${id}`}
        className="inline-flex items-center gap-1.5 text-xs font-medium mb-6 transition-colors hover:opacity-80"
        style={{ color: "#94a3b8" }}
      >
        ← Back to {vendor.name}
      </Link>

      <h1 className="text-2xl font-bold mb-1" style={{ color: "#f1f5f9" }}>
        New Assessment
      </h1>
      <p className="text-sm mb-8" style={{ color: "#94a3b8" }}>
        {vendor.name} · Record a point-in-time risk review
      </p>

      {signalContext && signalContext.matchedSignals.length > 0 && (
        <SignalContextCard context={signalContext} />
      )}

      <AssessmentForm vendorId={id} vendorName={vendor.name} />
    </div>
  );
}

function SignalContextCard({ context }: { context: VendorSignalContext }) {
  const severityColor: Record<string, string> = {
    Critical: "#fca5a5",
    High: "#fdba74",
    Moderate: "#fcd34d",
    Low: "#86efac",
  };

  return (
    <div
      className="rounded-xl border mb-8 p-5"
      style={{ background: "rgba(0,196,180,0.05)", borderColor: "rgba(0,196,180,0.2)" }}
    >
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "#00c4b4" }}>
          Threat Intelligence Context
        </span>
        {context.suggestedAssessmentSeverity && (
          <span
            className="text-xs px-2 py-0.5 rounded font-semibold"
            style={{
              background: "rgba(0,196,180,0.12)",
              color: severityColor[context.suggestedAssessmentSeverity] ?? "#94a3b8",
            }}
          >
            Suggested: {context.suggestedAssessmentSeverity}
          </span>
        )}
      </div>
      <p className="text-sm mb-4" style={{ color: "#cbd5e1" }}>
        {context.overallRiskSummary}
      </p>
      {context.matchedSignals.length > 0 && (
        <div className="space-y-3">
          {context.matchedSignals.map((signal, i) => (
            <div
              key={i}
              className="rounded-lg border p-3"
              style={{ background: "rgba(10,15,26,0.6)", borderColor: "#1e293b" }}
            >
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="text-xs font-semibold"
                  style={{ color: severityColor[signal.severity] ?? "#94a3b8" }}
                >
                  {signal.severity}
                </span>
                <span className="text-xs font-medium" style={{ color: "#f1f5f9" }}>
                  {signal.title}
                </span>
              </div>
              <p className="text-xs mb-1" style={{ color: "#94a3b8" }}>
                {signal.relevance}
              </p>
              {signal.suggestedFindingTitle && (
                <p className="text-xs" style={{ color: "#64748b" }}>
                  Suggested finding: {signal.suggestedFindingTitle}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
