"use server";

import { getSession } from "@/lib/session";
import { askQuestion, type AskResponse } from "@/lib/api";

export async function askAction(
  question: string
): Promise<AskResponse | { error: string }> {
  const session = await getSession();
  const token = session.jwtToken ?? null;
  if (!token) return { error: "Not authenticated" };
  const result = await askQuestion(token, question);
  if (!result) return { error: "Unable to process query" };
  return result;
}
