/**
 * Vendor-assurance PDF (.pdf) export — same-origin download proxy.
 * GET here → engine POST /api/vendor-assurance/documents/:id/export.pdf → stream bytes back.
 * The browser performs the save via the Content-Disposition the engine sets.
 *
 * Distinct from the inline PDF *preview* proxy at ../pdf/route.ts — that streams
 * the original uploaded SOC report for the on-screen viewer; this streams the
 * generated reviewed-state export with `attachment` disposition.
 */

import { type NextRequest } from "next/server";
import { proxyVendorAssuranceExport } from "@/lib/vendorAssuranceExportProxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
) {
  const { documentId } = await params;
  return proxyVendorAssuranceExport(req, documentId, "pdf");
}
