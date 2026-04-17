"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { updateControl, type Control } from "@/lib/api";

export async function updateControlCadence(
  controlId: string,
  data: {
    testing_frequency: Control["testing_frequency"];
    next_test_due: string | null;
  }
): Promise<{ error?: string }> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) return { error: "unauthenticated" };

  const result = await updateControl(token, controlId, {
    testing_frequency: data.testing_frequency,
    next_test_due: data.next_test_due,
  });

  if (!result) return { error: "update_failed" };

  revalidatePath(`/controls/${controlId}`);
  return {};
}
