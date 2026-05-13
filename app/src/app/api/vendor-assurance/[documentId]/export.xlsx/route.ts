/**
 * Vendor-assurance Excel (.xlsx) export — same-origin download proxy.
 * GET here → engine POST /api/vendor-assurance/documents/:id/export.xlsx → stream bytes back.
 * The browser performs the save via the Content-Disposition the engine sets.
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
  return proxyVendorAssuranceExport(req, documentId, "xlsx");
}
