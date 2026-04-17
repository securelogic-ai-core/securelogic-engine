import Link from "next/link";

export default async function ObligationEvidenceNewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <Link
        href={`/obligations/${id}`}
        className="inline-flex items-center gap-1.5 text-xs font-medium mb-6 transition-colors hover:opacity-80"
        style={{ color: "#94a3b8" }}
      >
        ← Obligation
      </Link>

      <h1 className="text-2xl font-bold mb-3" style={{ color: "#f1f5f9" }}>
        Add Evidence
      </h1>
      <p className="text-sm mb-8" style={{ color: "#94a3b8" }}>
        Attach evidence records to support compliance with this obligation.
      </p>

      <div
        className="rounded-xl border p-8 text-center"
        style={{ background: "#0d1626", borderColor: "#1e2d45" }}
      >
        <div className="text-4xl mb-4">📎</div>
        <h2 className="text-lg font-semibold mb-2" style={{ color: "#f1f5f9" }}>
          Coming Soon
        </h2>
        <p className="text-sm" style={{ color: "#94a3b8" }}>
          The evidence upload form is under construction.
        </p>
      </div>
    </div>
  );
}
