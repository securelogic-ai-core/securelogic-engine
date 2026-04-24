import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

export async function DELETE() {
  const session = await getSession();
  const token   = session.jwtToken;

  if (!token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const res = await fetch(`${ENGINE_URL}/api/dashboard/preferences`, {
    method:  "DELETE",
    headers: { "Authorization": `Bearer ${token}` },
    cache:   "no-store",
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
