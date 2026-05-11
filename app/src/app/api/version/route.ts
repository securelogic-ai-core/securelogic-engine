import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    commit: process.env.RENDER_GIT_COMMIT ?? "unknown",
    service: "securelogic-app",
    branch: process.env.RENDER_GIT_BRANCH ?? "unknown",
    deployedAt: new Date().toISOString(),
  });
}
