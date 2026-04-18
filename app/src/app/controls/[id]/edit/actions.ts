"use server";

import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";

const ENGINE_URL = process.env.ENGINE_API_URL ?? "http://localhost:4000";

export type ControlEditData = {
  name: string;
  description?: string | null;
  testing_frequency?: string | null;
  next_test_due?: string | null;
};

export async function updateControlAction(
  controlId: string,
  data: ControlEditData
): Promise<{ error: string } | never> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) return { error: "Not authenticated" };

  const body: Record<string, string | null> = { name: data.name };
  body.description      = data.description      ?? null;
  body.testing_frequency = data.testing_frequency ?? null;
  body.next_test_due    = data.next_test_due     ?? null;

  let res: Response;
  try {
    res = await fetch(`${ENGINE_URL}/api/controls/${controlId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    return { error: "Network error — please try again." };
  }

  if (res.ok) {
    redirect(`/controls/${controlId}`);
  }

  const json = (await res.json().catch(() => ({}))) as { error?: string; detail?: string };
  return { error: json.detail ?? json.error ?? "Failed to update control" };
}

export async function deleteControlAction(
  controlId: string
): Promise<{ error: string; details?: unknown } | never> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) return { error: "Not authenticated" };

  let res: Response;
  try {
    res = await fetch(`${ENGINE_URL}/api/controls/${controlId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
  } catch {
    return { error: "Network error — please try again." };
  }

  if (res.ok) {
    redirect("/controls");
  }

  const json = (await res.json().catch(() => ({}))) as { error?: string; details?: unknown };
  if (res.status === 409) {
    return { error: "has_children", details: json.details };
  }
  return { error: json.error ?? "Failed to delete control" };
}
