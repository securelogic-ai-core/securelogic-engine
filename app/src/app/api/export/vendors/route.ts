import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { type NextRequest, NextResponse } from "next/server";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) {
    redirect("/login");
  }

  const sp = request.nextUrl.searchParams;
  const qs = sp.toString();

  let upstream: Response;
  try {
    upstream = await fetch(
      `${ENGINE_URL}/api/vendors/export.csv${qs ? `?${qs}` : ""}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      }
    );
  } catch {
    return NextResponse.json({ error: "engine_unavailable" }, { status: 502 });
  }

  if (!upstream.ok) {
    return NextResponse.json({ error: "upstream_error" }, { status: upstream.status });
  }

  const body = await upstream.arrayBuffer();
  const contentDisposition =
    upstream.headers.get("content-disposition") ??
    `attachment; filename="vendors-${new Date().toISOString().slice(0, 10)}.csv"`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": contentDisposition,
    },
  });
}
