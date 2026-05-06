import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import {
  getMe,
  getRiskById,
  getRiskTreatmentById,
  getRiskTreatments,
} from "@/lib/api";
import { TreatmentDetailClient } from "./TreatmentDetailClient";

const NON_TERMINAL = new Set(["not_started", "in_progress"]);

export default async function TreatmentDetailPage({
  params,
}: {
  params: Promise<{ id: string; tid: string }>;
}) {
  const { id, tid } = await params;

  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const me = await getMe(token);
  const entitlementLevel = me?.entitlementLevel ?? "starter";
  const isPlatformUser = ["premium", "platform", "team"].includes(entitlementLevel);
  if (!isPlatformUser) redirect("/dashboard");

  const [risk, treatment, siblings] = await Promise.all([
    getRiskById(token, id),
    getRiskTreatmentById(token, tid),
    getRiskTreatments(token, { risk_id: id, limit: 50 }),
  ]);

  if (!risk || !treatment) notFound();

  // Defensive — if a treatment id is mounted under a risk id that
  // doesn't own it, treat as not-found rather than rendering a
  // mismatched detail page.
  if (treatment.risk_id !== id) notFound();

  // Count of OTHER non-terminal treatments under the same risk.
  // Drives the multi-treatment confirmation modal: when transitioning
  // this treatment to terminal, the parent risk's status sync will
  // overwrite an open work-in-progress signal from siblings.
  const allTreatments = siblings?.treatments ?? [];
  const nonTerminalSiblingCount = allTreatments.filter(
    (t) => t.id !== tid && NON_TERMINAL.has(t.status)
  ).length;

  return (
    <div className="max-w-3xl mx-auto px-6 py-12">
      <div className="mb-6">
        <Link
          href={`/risks/${id}`}
          style={{ color: "#60a5fa", fontSize: 13, textDecoration: "none" }}
        >
          ← {risk.title}
        </Link>
      </div>

      <TreatmentDetailClient
        riskId={id}
        treatment={treatment}
        nonTerminalSiblingCount={nonTerminalSiblingCount}
      />
    </div>
  );
}
