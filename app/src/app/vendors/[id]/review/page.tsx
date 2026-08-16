"use server";

import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import {
  legacyVendorWritesEnabled,
  engagementCta,
  LEGACY_WRITE_RETIRED_COPY,
} from "@/lib/legacyVendorWrites";
import { getVendor } from "@/lib/api";
import { ReviewForm } from "./ReviewForm";

export default async function VendorReviewPage({
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

  // B1 demotion: with legacy writes off, this form's submit would 410 at the
  // engine — render the retirement notice instead of a dead-end form.
  if (!legacyVendorWritesEnabled()) {
    const cta = engagementCta(id);
    return (
      <div className="max-w-2xl mx-auto px-6 py-12">
        <Link
          href={`/vendors/${id}`}
          className="inline-flex items-center gap-1.5 text-xs font-medium mb-6 transition-colors hover:opacity-80"
          style={{ color: "#94a3b8" }}
        >
          ← Back to {vendor.name}
        </Link>
        <h1 className="text-2xl font-bold mb-3" style={{ color: "#f1f5f9" }}>
          Review cycles have moved
        </h1>
        <p className="text-sm mb-8" style={{ color: "#94a3b8" }}>
          {LEGACY_WRITE_RETIRED_COPY} Existing review records stay visible on
          the vendor page.
        </p>
        <Link
          href={cta.href}
          className="inline-flex items-center justify-center px-5 py-2 rounded-lg text-sm font-semibold"
          style={{ background: "#00c4b4", color: "#0a0f1a" }}
        >
          {cta.label}
        </Link>
      </div>
    );
  }

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
        New Review Cycle
      </h1>
      <p className="text-sm mb-8" style={{ color: "#94a3b8" }}>
        {vendor.name} · Open a vendor risk review workflow
      </p>

      <ReviewForm vendorId={id} />
    </div>
  );
}
