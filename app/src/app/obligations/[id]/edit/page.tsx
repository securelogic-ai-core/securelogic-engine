import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/session";
import { getObligation } from "@/lib/api";
import { EditObligationForm } from "./EditObligationForm";

export default async function EditObligationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const obligation = await getObligation(token, id);
  if (!obligation) redirect("/obligations");

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <Link
        href={`/obligations/${id}`}
        className="inline-flex items-center gap-1.5 text-xs font-medium mb-6 transition-colors hover:opacity-80"
        style={{ color: "#94a3b8" }}
      >
        ← {obligation.title}
      </Link>

      <h1 className="text-2xl font-bold mb-2" style={{ color: "#f1f5f9" }}>
        Edit Obligation
      </h1>
      <p className="text-sm mb-8" style={{ color: "#94a3b8" }}>
        Update details for this obligation.
      </p>

      <EditObligationForm obligation={obligation} />
    </div>
  );
}
