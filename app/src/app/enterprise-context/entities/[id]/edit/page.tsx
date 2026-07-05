import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getEnterpriseEntity } from "@/lib/api";
import { readFailure } from "@/lib/enterpriseContextFormat";
import { ReadFailurePanel } from "../../../shared";
import EntityForm from "../../EntityForm";

export default async function EditEnterpriseEntityPage({
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

  const result = await getEnterpriseEntity(token, id);

  if (!result.ok) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-12">
        <Link
          href="/enterprise-context"
          className="inline-flex items-center gap-1.5 text-xs font-medium mb-6 transition-colors hover:opacity-80"
          style={{ color: "#94a3b8" }}
        >
          ← Enterprise Context
        </Link>
        <ReadFailurePanel {...readFailure(result)} />
      </div>
    );
  }

  const entity = result.enterprise_entity;

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <Link
        href={`/enterprise-context/entities/${entity.id}`}
        className="inline-flex items-center gap-1.5 text-xs font-medium mb-6 transition-colors hover:opacity-80"
        style={{ color: "#94a3b8" }}
      >
        ← {entity.name}
      </Link>

      <h1 className="text-2xl font-bold mb-2" style={{ color: "#f1f5f9" }}>
        Edit Entity
      </h1>
      <p className="text-sm mb-8" style={{ color: "#94a3b8" }}>
        Update details for {entity.name}.
      </p>

      <EntityForm entity={entity} />
    </div>
  );
}
