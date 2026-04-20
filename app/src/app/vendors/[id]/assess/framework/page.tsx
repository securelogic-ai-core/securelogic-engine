import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getVendor, getFrameworks, getFrameworkRequirements } from "@/lib/api";
import { FrameworkSelector } from "./FrameworkSelector";
import { VendorAssessmentChecklist } from "./VendorAssessmentChecklist";
import Link from "next/link";

export default async function VendorFrameworkAssessPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const selectedFrameworkId = sp["frameworkId"] ?? null;

  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const [vendor, frameworksData] = await Promise.all([
    getVendor(token, id),
    getFrameworks(token),
  ]);

  if (!vendor) redirect("/vendors");

  const frameworks = frameworksData?.frameworks ?? [];

  let requirementsData = null;
  let selectedFramework = null;
  if (selectedFrameworkId) {
    selectedFramework = frameworks.find((f) => f.id === selectedFrameworkId) ?? null;
    if (selectedFramework) {
      requirementsData = await getFrameworkRequirements(
        token,
        selectedFrameworkId,
        "vendor",
        id
      );
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-12">
      <Link
        href={`/vendors/${id}`}
        className="inline-flex items-center gap-1.5 text-xs font-medium mb-6 hover:opacity-80 transition-opacity"
        style={{ color: "#94a3b8" }}
      >
        ← {vendor.name}
      </Link>

      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-0.5" style={{ color: "#f1f5f9" }}>
          Framework Assessment
        </h1>
        <p className="text-sm" style={{ color: "#94a3b8" }}>
          Assess {vendor.name} against a compliance framework
        </p>
      </div>

      {selectedFramework && requirementsData ? (
        <>
          <div className="flex items-center gap-3 mb-6">
            <p className="text-sm font-semibold" style={{ color: "#f1f5f9" }}>
              {selectedFramework.name}
            </p>
            <span className="text-xs" style={{ color: "#475569" }}>v{selectedFramework.version}</span>
            <Link
              href={`/vendors/${id}/assess/framework`}
              className="text-xs hover:underline ml-auto"
              style={{ color: "#94a3b8" }}
            >
              Change framework
            </Link>
          </div>
          <VendorAssessmentChecklist
            vendorId={id}
            frameworkId={selectedFrameworkId!}
            initialData={requirementsData}
          />
        </>
      ) : (
        <FrameworkSelector vendorId={id} frameworks={frameworks} />
      )}
    </div>
  );
}
