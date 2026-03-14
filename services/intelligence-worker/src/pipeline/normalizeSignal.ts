import { Signal } from "../models/Signal.js";
import { SignalIngestedEvent } from "../types/events.js";

function classifyCategory(title: string, rawContent: string) {
  const text = `${title} ${rawContent}`.toLowerCase();

  // SECURITY first
  if (
    text.includes("breach") ||
    text.includes("malware") ||
    text.includes("ransomware") ||
    text.includes("phishing") ||
    text.includes("credential") ||
    text.includes("attack") ||
    text.includes("trojan") ||
    text.includes("exploit") ||
    text.includes("hackers") ||
    text.includes("cybercrime") ||
    text.includes("click-fix") ||
    text.includes("click fix") ||
    text.includes("vpn client") ||
    text.includes("seo poisoning") ||
    text.includes("end-to-end encrypted") ||
    text.includes("encrypted chat") ||
    text.includes("e2ee")
  ) {
    return "SECURITY_INCIDENT";
  }

  // REGULATION next
  if (
    text.includes("regulation") ||
    text.includes("guidance") ||
    text.includes("regulator") ||
    text.includes("commission") ||
    text.includes("eu ai act") ||
    text.includes("implementation guidance") ||
    text.includes("enforcement")
  ) {
    return "REGULATION";
  }

  // COMPLIANCE next
  if (
    text.includes("soc 2") ||
    text.includes("nist") ||
    text.includes("iso") ||
    text.includes("compliance")
  ) {
    return "COMPLIANCE_UPDATE";
  }

  // VENDOR RISK next
  if (
    text.includes("vendor") ||
    text.includes("third-party") ||
    text.includes("third party") ||
    text.includes("supplier") ||
    text.includes("saas")
  ) {
    return "VENDOR_RISK";
  }

  // AI GOVERNANCE last
  if (
    text.includes("artificial intelligence") ||
    text.includes(" ai ") ||
    text.startsWith("ai ") ||
    text.endsWith(" ai") ||
    text.includes("llm") ||
    text.includes("foundation model") ||
    text.includes("open-source ai") ||
    text.includes("open source ai") ||
    text.includes("ai model") ||
    text.includes("model governance") ||
    text.includes("ai governance")
  ) {
    return "AI_GOVERNANCE";
  }

  return "GENERAL";
}

export function normalizeSignal(event: SignalIngestedEvent): Signal {
  const raw =
    typeof event.payload === "string"
      ? event.payload
      : JSON.stringify(event.payload);

  return {
    id: event.signalId,
    title: event.title,
    source: event.source,
    category: classifyCategory(event.title, raw),
    summary: raw.slice(0, 200),
    rawContent: raw,
    tags: [],
    timestamp: event.timestamp,
    processed: false
  };
}