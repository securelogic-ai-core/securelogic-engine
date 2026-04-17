import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

export default async function VendorAssessPage({
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
              d="M11.54 22.351l.07.04.028.016a.76.76 0 0 0 .723 0l.028-.015.071-.041a16.975 16.975 0 0 0 1.144-.742 19.58 19.58 0 0 0 2.683-2.282c1.944-1.99 3.963-4.98 3.963-8.827a8.25 8.25 0 0 0-16.5 0c0 3.846 2.02 6.837 3.963 8.827a19.58 19.58 0 0 0 2.682 2.282 16.975 16.975 0 0 0 1.145.742Z"
              clipRule="evenodd"
            />
          </svg>
        </div>

        <h1 className="text-xl font-bold mb-2" style={{ color: "#f1f5f9" }}>
          Coming Soon
        </h1>
        <p className="text-sm mb-6" style={{ color: "#94a3b8" }}>
          The vendor assessment form will allow you to record a point-in-time
          risk review for this vendor. Each assessment automatically creates a
          finding in the platform.
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
