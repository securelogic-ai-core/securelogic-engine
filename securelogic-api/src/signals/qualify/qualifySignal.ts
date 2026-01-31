import { Signal } from "../contract/Signal";
import { SignalStatus } from "../contract/SignalStatus";
import { QUALIFICATION_RULES } from "./qualificationRules";

function isRecent(publishedAt: string): boolean {
  const published = new Date(publishedAt).getTime();
  const now = Date.now();
  const maxAgeMs = QUALIFICATION_RULES.maxAgeDays * 24 * 60 * 60 * 1000;
  return now - published <= maxAgeMs;
}

export function qualifySignal(signal: Signal): Signal {
  if (!QUALIFICATION_RULES.allowedSources.includes(signal.source)) {
    return { ...signal, status: SignalStatus.DISCARDED };
  }

  if (!isRecent(signal.publishedAt)) {
    return { ...signal, status: SignalStatus.DISCARDED };
  }

  return { ...signal, status: SignalStatus.QUALIFIED };
}
