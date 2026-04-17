import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

export async function POST(request: Request) {
  try {
    const session = await getSession();
    const token = session.jwtToken ?? session.apiKey ?? null;

    if (!token) {
      return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
    }

    const formData = await request.formData();
    const file = formData.get("document");
    const vendorName = (formData.get("vendor_name") as string | null)?.trim() ?? "";
    const documentHint = (formData.get("document_hint") as string | null)?.trim() ?? "";

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ error: "no_file_uploaded" }, { status: 400 });
    }

    if (!vendorName) {
      return NextResponse.json({ error: "vendor_name_required" }, { status: 400 });
    }

    // Proxy to engine — engine owns the multer + Claude analysis logic.
    const proxyForm = new FormData();
    proxyForm.append("document", file, (file as File).name ?? "document");
    proxyForm.append("vendor_name", vendorName);
    if (documentHint) proxyForm.append("document_hint", documentHint);

    const res = await fetch(`${ENGINE_URL}/api/vendor-assessments/analyze-document`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: proxyForm,
      // @ts-expect-error — duplex required for streaming request body in Node
      duplex: "half",
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return NextResponse.json(
        { error: body.error ?? "analysis_failed" },
        { status: res.status }
      );
    }

    const body = await res.json();
    return NextResponse.json(body);
  } catch {
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
