"use server";

import { getSession } from "@/lib/session";
import { askQuestion, type AskResponse, type AskResult } from "@/lib/api";

// Mirror AskResult so the client can switch on the same shape regardless
// of whether the failure originated in the API client (network, parse) or
// in the engine (HTTP error with body). Auth failures here are reported
// with code: "unauthorized" so the client maps them through the same
// error-message table as engine-side errors.
export type AskActionResult = AskResult;

export async function askAction(
  question: string
): Promise<AskActionResult> {
  const session = await getSession();
  const token = session.jwtToken ?? null;
  if (!token) {
    return {
      ok: false,
      status: 401,
      code: "unauthorized",
      message: "Not authenticated",
    };
  }
  return askQuestion(token, question);
}

export type { AskResponse };
