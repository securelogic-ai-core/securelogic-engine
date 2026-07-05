import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import EntityForm from "../EntityForm";

export default async function NewEnterpriseEntityPage() {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  const entitlementLevel = session.entitlementLevel ?? "free";
  const isPlatformUser =
    entitlementLevel === "premium" ||
    entitlementLevel === "platform" ||
    entitlementLevel === "team";
  if (!isPlatformUser) redirect("/dashboard");

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <Link
        href="/enterprise-context"
        className="inline-flex items-center gap-1.5 text-xs font-medium mb-6 transition-colors hover:opacity-80"
        style={{ color: "#94a3b8" }}
      >
        ← Enterprise Context
      </Link>

      <h1 className="text-2xl font-bold mb-2" style={{ color: "#f1f5f9" }}>
        Add Entity
      </h1>
      <p className="text-sm mb-8" style={{ color: "#94a3b8" }}>
        Register an asset, application, service, data store, or organizational unit.
      </p>

      <EntityForm />
    </div>
  );
}
