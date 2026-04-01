import { Signal } from "../models/Signal.js";
import { SignalIngestedEvent } from "../types/events.js";
import { cleanText } from "../utils/contentSanitizer.js";
import { classifyCategory } from "./classifyCategory.js";

export function normalizeSignal(event: SignalIngestedEvent): Signal {
  const raw =
    typeof event.payload === "string"
      ? event.payload
      : JSON.stringify(event.payload);

  const cleaned = cleanText(raw);

  return {
    id: event.signalId,
    title: cleanText(event.title),
    source: event.source,
    category: classifyCategory(event.title, cleaned),
    summary: cleaned.slice(0, 200),
    rawContent: cleaned,
    tags: [],
    timestamp: event.timestamp,
    processed: false
  };
}
