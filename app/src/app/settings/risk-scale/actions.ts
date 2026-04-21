"use server";

import { getSession } from "@/lib/session";
import { getRiskScale, getRiskScalePresets, updateRiskScale, type RiskScale } from "@/lib/api";

export async function getRiskScaleAction(): Promise<RiskScale | null> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) return null;
  return getRiskScale(token);
}

export async function getRiskScalePresetsAction(): Promise<RiskScale[] | null> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) return null;
  return getRiskScalePresets(token);
}

export async function updateRiskScaleAction(body: {
  preset_name: string;
  custom_levels?: Partial<{ value: string; label: string; color: string; rank: number }>[];
}): Promise<RiskScale | { error: string; message?: string }> {
  const session = await getSession();
  const token = session.jwtToken ?? session.apiKey ?? null;
  if (!token) return { error: "not_authenticated" };

  const result = await updateRiskScale(token, body);
  if (!result) return { error: "update_failed" };
  return result;
}
