import { randomUUID } from "crypto";
import { TrialKey } from "./TrialKey.js";

const TRIAL_DAYS = 7;

export const trialKeys = new Map<string, TrialKey>();

export function issueTrialKey(): TrialKey {
  const key = `trial_${randomUUID()}`;
  const expiresAt = new Date(
    Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const record: TrialKey = {
    key,
    expiresAt,
    tier: "PREVIEW"
  };

  trialKeys.set(key, record);
  return record;
}

export function findTrialKey(key: string): TrialKey | undefined {
  return trialKeys.get(key);
}

export function isExpired(trial: TrialKey): boolean {
  return new Date(trial.expiresAt) < new Date();
}

export function expireKey(key: string): boolean {
  const record = trialKeys.get(key);
  if (!record) return false;

  record.expiresAt = new Date(0).toISOString();
  trialKeys.set(key, record);
  return true;
}
