import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { vendorAssuranceEnabled } from "@/lib/vendorAssuranceFeatureFlag";
import { isPlatformEntitled } from "@/lib/entitlements";
import { getVendors, listVendorRelationships } from "@/lib/api";
import CreateEngagementForm from "@/components/vendorEngagements/CreateEngagementForm";
import OpenFromRelationship from "@/components/vendorEngagements/OpenFromRelationship";

/**
 * /vendor-engagements/new — open an engagement.
 *
 * One POST computes inherent risk from the full intake, so the form requires
 * every field: the engine deliberately refuses a defaulted intake (a confident
 * score from answers nobody gave), and this page mirrors that stance.
 */
export default async function NewVendorEngagementPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  // VA-NAV-1 activation gate — precedes session and entitlement on purpose:
  // a disabled capability answers notFound() to everyone, never the
  // entitlement redirect, so a probe cannot tell "off" from "not yours".
  // Same key and resolver as the engine, which 404s the API independently.
  if (!vendorAssuranceEnabled()) notFound();
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) redirect("/login");

  if (!isPlatformEntitled(session.entitlementLevel)) redirect("/dashboard");

  const vendorsResp = await getVendors(token, "active", { limit: 100 });
  const vendors = (vendorsResp?.vendors ?? []).map((v) => ({ id: v.id, name: v.name }));

  // Deep links from the vendor page's demoted legacy CTAs carry ?vendorId=;
  // the form validates it against the fetched vendor list before honoring it.
  const sp = searchParams ? await searchParams : {};
  const defaultVendorId = sp.vendorId;
  // Vendor Onboarding 2.0: if the vendor already has relationships, offer to
  // open from one (inheriting its derived classification) before the pre-2.0
  // form that re-asks the intake.
  const relationships = defaultVendorId ? (await listVendorRelationships(token, defaultVendorId))?.relationships ?? [] : [];

  return (
    <main style={{ padding: "32px", maxWidth: 860, margin: "0 auto", color: "#e5e7eb" }}>
      <header style={{ marginBottom: 24 }}>
        <Link href="/vendor-engagements" style={{ color: "#93c5fd", fontSize: 13 }}>
          ← Vendor engagements
        </Link>
        <h1 style={{ fontSize: 28, fontWeight: 600, margin: "8px 0 0" }}>New engagement</h1>
        <p style={{ color: "#9ca3af", marginTop: 8 }}>
          The intake computes the vendor&apos;s inherent risk and derives the assessment tier —
          which determines the questionnaire scope. Every question is required: a defaulted
          answer would produce a rating indistinguishable from an assessed one.
        </p>
      </header>

      {vendors.length === 0 ? (
        <div style={{ padding: 24, border: "1px dashed #374151", borderRadius: 8, color: "#9ca3af" }}>
          No active vendors on record. <Link href="/vendors/new" style={{ color: "#93c5fd" }}>Add a vendor</Link> first.
        </div>
      ) : (
        <>
          {defaultVendorId && <OpenFromRelationship vendorId={defaultVendorId} relationships={relationships} />}
          <CreateEngagementForm
            vendors={vendors}
            {...(defaultVendorId !== undefined ? { defaultVendorId } : {})}
          />
        </>
      )}
    </main>
  );
}
