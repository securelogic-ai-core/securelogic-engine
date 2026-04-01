import { Signal } from "../models/Signal.js";
import { SignalIngestedEvent } from "../types/events.js";
import { classifyCategory } from "./classifyCategory.js";

export function normalizeSignal(event: SignalIngestedEvent): Signal {
  const raw =
    typeof event.payload === "string"
      ? event.payload
      : JSON.stringify(event.payload);

  const classification = classifyCategory(event.title, raw);

  return {
    id: event.signalId,
    title: event.title,
    source: event.source,
    category: classification.primary,
    categories: classification.all,
    categoryReason: classification.reason,
    summary: raw.slice(0, 200),
    rawContent: raw,
    tags: classification.all,
    timestamp: event.timestamp,
    processed: false
  };
}
