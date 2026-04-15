import { NextResponse } from "next/server";
import { authSignup } from "@/lib/api";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      organizationName?: unknown;
      name?: unknown;
      email?: unknown;
      password?: unknown;
      promoCode?: unknown;
    };

    const organizationName = typeof body.organizationName === "string" ? body.organizationName.trim() : "";
    const name             = typeof body.name === "string" ? body.name.trim() : "";
    const email            = typeof body.email === "string" ? body.email.trim() : "";
    const password         = typeof body.password === "string" ? body.password : "";
    const promoCode        = typeof body.promoCode === "string" && body.promoCode.trim() ? body.promoCode.trim() : undefined;

    if (!organizationName || !name || !email || !password) {
      return NextResponse.json({ error: "missing_fields" }, { status: 400 });
    }

    const result = await authSignup(organizationName, name, email, password, promoCode);

    if ("error" in result) {
      const status = result.error === "email_already_registered" ? 409 : 400;
      return NextResponse.json(result, { status });
    }

    return NextResponse.json(result, { status: 201 });
  } catch {
    return NextResponse.json({ error: "signup_failed" }, { status: 500 });
  }
}
