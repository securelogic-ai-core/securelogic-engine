import { type NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

/**
 * EAR P16: proxies POST /api/assets/import (multipart CSV/XLSX bulk import for
 * the four detail-backed asset types, dry-run or commit) to the engine with the
 * session token. Sibling of the enterprise-context/import proxy. Only the
 * whitelisted `asset_type` and `mode` query params and the `file` field are
 * forwarded; the engine re-validates. Engine gating (404 flag-off / 403
 * capability) is passed straight through. Content-Type is left unset so fetch
 * derives the multipart boundary from the rebuilt FormData.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  const inParams = request.nextUrl.searchParams;
  const outParams = new URLSearchParams();
  const assetType = inParams.get("asset_type");
  const mode = inParams.get("mode");
  if (assetType) outParams.set("asset_type", assetType);
  if (mode) outParams.set("mode", mode);

  let outForm: FormData;
  try {
    const inForm = await request.formData();
    const file = inForm.get("file");
    if (!file) {
      return NextResponse.json({ error: "no_file_uploaded" }, { status: 400 });
    }
    outForm = new FormData();
    outForm.set("file", file);
  } catch {
    return NextResponse.json({ error: "invalid_multipart" }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${ENGINE_URL}/api/assets/import?${outParams.toString()}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: outForm,
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "engine_unavailable" }, { status: 502 });
  }

  const body = await upstream.json().catch(() => ({ error: "invalid_json" }));
  return NextResponse.json(body, { status: upstream.status });
}
