"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { authCompleteOnboarding } from "@/lib/api";

export async function completeOnboardingAction(): Promise<void> {
  const session = await getSession();
  const token = session.jwtToken ?? null;

  if (token) {
    await authCompleteOnboarding(token);
    session.onboardingCompleted = true;
    await session.save();
  }

  redirect("/dashboard");
}
