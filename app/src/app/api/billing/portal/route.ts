import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { createPortalSession } from "@/lib/api";

export async function POST() {
  const session = await getSession();

  if (!session.apiKey) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  const result = await createPortalSession(session.apiKey);

  if (!result) {
    return NextResponse.json(
      { error: "Could not open billing portal. Please try again." },
      { status: 502 }
    );
  }

  return NextResponse.json({ portalUrl: result.portalUrl });
}
