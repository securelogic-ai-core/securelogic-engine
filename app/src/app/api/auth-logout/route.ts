import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
import { getSessionOptions, type SessionData } from "@/lib/session";

export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const session = await getIronSession<SessionData>(cookieStore, getSessionOptions());
    session.destroy();
    return NextResponse.redirect(new URL("/login", request.url));
  } catch {
    return NextResponse.redirect(new URL("/login", request.url));
  }
}
