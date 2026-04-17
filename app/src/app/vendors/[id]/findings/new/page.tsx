import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

export default async function NewVendorFindingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <Link
        href={`/vendors/${id}`}
        className="inline-flex items-center gap-1.5 text-xs font-medium mb-6 transition-colors hover:opacity-80"
        style={{ color: "#94a3b8" }}
      >
        ← Back to vendor
      </Link>

      <div className="bg-brand-surface border border-brand-line rounded-xl p-10 text-center">
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-5"
          style={{ background: "rgba(0,196,180,0.12)" }}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="w-6 h-6"
            style={{ color: "#00c4b4" }}
          >
            <path
              fillRule="evenodd"
              d="M9.401 3.003c1.155-2 4.043-2 5.197 0l7.355 12.748c1.154 2-.29 4.5-2.599 4.5H4.645c-2.309 0-3.752-2.5-2.598-4.5L9.4 3.003ZM12 8.25a.75.75 0 0 1 .75.75v3.75a.75.75 0 0 1-1.5 0V9a.75.75 0 0 1 .75-.75Zm0 8.25a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z"
              clipRule="evenodd"
            />
          </svg>
        </div>

        <h1 className="text-xl font-bold mb-2" style={{ color: "#f1f5f9" }}>
          Coming Soon
        </h1>
        <p className="text-sm mb-6" style={{ color: "#94a3b8" }}>
          The manual finding form will let you record a vendor risk finding
          directly — outside of a formal assessment or review cycle. Use this
          to capture ad-hoc observations, escalations from external sources,
          or findings identified during contract review.
        </p>

        <Link
          href={`/vendors/${id}`}
          className="inline-flex items-center gap-1.5 text-sm font-medium transition-colors hover:opacity-80"
          style={{ color: "#00c4b4" }}
        >
          ← Back to vendor
        </Link>
      </div>
    </div>
  );
}
