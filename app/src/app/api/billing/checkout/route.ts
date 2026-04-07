import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { createCheckoutSession } from "@/lib/api";

export async function POST() {
  const session = await getSession();

  if (!session.apiKey) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  const result = await createCheckoutSession(session.apiKey);

  if (!result) {
    return NextResponse.json(
      { error: "Could not create checkout session. Please try again." },
      { status: 502 }
    );
  }

  return NextResponse.json({ checkoutUrl: result.checkoutUrl });
}
