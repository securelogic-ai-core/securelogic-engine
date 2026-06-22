"use server";

import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { getVendor } from "@/lib/api";
import { FindingForm } from "./FindingForm";

export default async function NewVendorFindingPage({
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

  const vendor = await getVendor(token, id);
  if (!vendor) redirect("/vendors");

  return (
    <div className="max-w-2xl mx-auto px-6 py-12">
      <Link
        href={`/vendors/${id}`}
        className="inline-flex items-center gap-1.5 text-xs font-medium mb-6 transition-colors hover:opacity-80"
        style={{ color: "#94a3b8" }}
      >
        ← Back to {vendor.name}
      </Link>

      <h1 className="text-2xl font-bold mb-1" style={{ color: "#f1f5f9" }}>
        New Finding
      </h1>
      <p className="text-sm mb-8" style={{ color: "#94a3b8" }}>
        {vendor.name} · Manually record a vendor risk finding
      </p>

      <FindingForm vendorId={id} />
    </div>
  );
}
