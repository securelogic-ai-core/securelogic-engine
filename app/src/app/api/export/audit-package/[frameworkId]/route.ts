import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { type NextRequest, NextResponse } from "next/server";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ frameworkId: string }> }
): Promise<NextResponse> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) {
    redirect("/login");
  }

  const { frameworkId } = await params;

  let upstream: Response;
  try {
    upstream = await fetch(
      `${ENGINE_URL}/api/frameworks/${encodeURIComponent(frameworkId)}/audit-package.pdf`,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      }
    );
  } catch {
    return NextResponse.json({ error: "engine_unavailable" }, { status: 502 });
  }

  if (!upstream.ok) {
    const status = upstream.status === 404 ? 404 : 502;
    return NextResponse.json({ error: "upstream_error" }, { status });
  }

  const body = await upstream.arrayBuffer();
  const contentDisposition =
    upstream.headers.get("content-disposition") ??
    `attachment; filename="audit-package-${frameworkId}.pdf"`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": contentDisposition,
    },
  });
}
